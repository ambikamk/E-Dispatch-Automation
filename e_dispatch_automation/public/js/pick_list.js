frappe.ui.form.on("Pick List", {
    refresh: function (frm) {
        let allPicked = frm.doc.locations && frm.doc.locations.length > 0 &&
            frm.doc.locations.every(row => (row.picked_qty || 0) >= (row.qty || 0));

        if (!allPicked) {
            frm.add_custom_button(__('Show Scanner'), function () {
                let d = new frappe.ui.Dialog({
                    title: "Scan QR Code",
                    fields: [
                        {
                            fieldname: "scanner_area",
                            label: "QR Scanner",
                            fieldtype: "HTML"
                        },
                        {
                            fieldname: "scanned_data",
                            label: "Scanned Data",
                            fieldtype: "Small Text",
                            read_only: 1
                        }
                    ]
                });
                d.show();

                if (!window.dynamsoft_loaded) {
                    const script = document.createElement("script");
                    script.src = "https://cdn.jsdelivr.net/npm/dynamsoft-javascript-barcode@9.3.1/dist/dbr.js";
                    script.onload = () => {
                        window.dynamsoft_loaded = true;
                        initScanner(d, frm);
                    };
                    document.body.appendChild(script);
                } else {
                    initScanner(d, frm);
                }

                d.onhide = () => {
                    if (window.scanner) {
                        window.scanner.destroyContext();
                        window.scanner = null;
                    }
                };
            });
        }
    }
});
async function initScanner(d, frm) {
    Dynamsoft.DBR.BarcodeScanner.license =
        "DLS2eyJoYW5kc2hha2VDb2RlIjoiMTA0NDYwMDEzLU1UQTBORFl3TURFekxYZGxZaTFVY21saGJGQnliMm8iLCJtYWluU2VydmVyVVJMIjoiaHR0cHM6Ly9tZGxzLmR5bmFtc29mdG9ubGluZS5jb20iLCJvcmdhbml6YXRpb25JRCI6IjEwNDQ2MDAxMyIsInN0YW5kYnlTZXJ2ZXJVUkwiOiJodHRwczovL3NkbHMuZHluYW1zb2Z0b25saW5lLmNvbSIsImNoZWNrQ29kZSI6LTU5MTgwMDk3Mn0=";

    await Dynamsoft.DBR.BarcodeScanner.loadWasm();
    window.scanner = await Dynamsoft.DBR.BarcodeScanner.createInstance();

    const area = d.get_field("scanner_area").$wrapper[0];
    area.innerHTML = `<div id="scanner-container" style="width:100%;height:300px;"></div>`;

    scanner.onFrameRead = results => {
        for (let result of results) {
            if (!result.barcodeText) continue;

            d.set_value("scanned_data", result.barcodeText);

            let qr_data;
            try {
                qr_data = JSON.parse(result.barcodeText);
            } catch (e) {
                frappe.msgprint("Invalid QR data.");
                return;
            }

            const scanned_item = (qr_data.item || "").trim().toLowerCase();
            const scanned_wh = (qr_data.fg_warehouse || "").trim().toLowerCase();
            const scanned_batch = (qr_data.batch_no || "").trim().toLowerCase();
            const scanned_box = (qr_data.box_no || "").trim().toLowerCase();
            let qty_to_pick = qr_data.qty || 1;
            let updated = false;
            const updates = [];
            let duplicateFound = false;
            const processRows = async () => {
                for (const row of frm.doc.locations) {
                    if (qty_to_pick <= 0) break;

                    const row_item = (row.item_code || "").trim().toLowerCase();
                    const row_wh = (row.warehouse || "").trim().toLowerCase();
                    const row_batch = (row.batch_no || "").trim().toLowerCase();
                    let matchByQrCode = false;
                    if (row_batch) {
                        const batchDoc = await frappe.db.get_doc("Batch", row_batch);
                        if (batchDoc && batchDoc.custom_qr_code) {
                            matchByQrCode = batchDoc.custom_qr_code.some(
                                qr => (qr.qr_code_id || "").trim().toLowerCase() === scanned_box
                            );
                        }
                    }
                    if ((row_item === scanned_item && row_wh === scanned_wh && row_batch === scanned_batch) || matchByQrCode) {
                        let current_item_no = (row.item_no || "").trim();
                        let qr_list = current_item_no ? current_item_no.split(",") : [];
                        if (qr_list.includes(scanned_box)) {
                            duplicateFound = true;
                            break;
                        }
                        let available = (row.qty || 0) - (row.picked_qty || 0);
                        if (available > 0) {
                            let add_qty = Math.min(available, qty_to_pick);
                            let new_picked = (row.picked_qty || 0) + add_qty;
                            qty_to_pick -= add_qty;
                            updated = true;
                            updates.push(frappe.model.set_value(row.doctype, row.name, "picked_qty", new_picked));
                            for (let i = 0; i < add_qty; i++) {
                                qr_list.push(scanned_box);
                            }
                            let new_item_no = qr_list.join(",");
                            updates.push(frappe.model.set_value(row.doctype, row.name, "item_no", new_item_no));
                        }
                    }
                }
                if (duplicateFound) {
                    frappe.msgprint("This QR code has already been scanned for this item.");
                } else if (updated) {
                    await Promise.all(updates);
                    frm.save().then(() => {
                        frappe.show_alert({ message: "Picked Qty & QR Codes Updated!", indicator: "green" });
                        frm.refresh();
                    });
                } else {
                    frappe.msgprint("No matching Item or QR Code Found");
                }

                if (window.scanner) {
                    window.scanner.destroyContext();
                    window.scanner = null;
                }
                d.hide();
                 setTimeout(() => {
                window.location.reload();
            }, 500);
            };

            processRows();
            break;
        }
    };
    const uiElement = scanner.getUIElement();
    uiElement.style.width = "100%";
    uiElement.style.height = "280px";

    area.querySelector("#scanner-container").appendChild(uiElement);

    await scanner.open();
}
