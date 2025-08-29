frappe.ui.form.on('Work Order', {
    refresh: function(frm) {
        if (!frm.is_new()) {

            frm.remove_custom_button(__('Start'));
            frm.remove_custom_button(__('Finish'));
            if (frm.doc.custom_production_completed) {
                return;
            }
            if (frm.doc.custom_scanned_qty == frm.doc.qty) {
                frm.add_custom_button("Complete Production", function() {
                    frappe.call({
                        method: "e_dispatch_automation.events.work_order.complete_production", 
                        args: {
                            bom: frm.doc.bom_no,
                            work_order:frm.doc.name,
                            scanned_qty:frm.doc.custom_scanned_qty,
                            work_in_progress_warehouse:frm.doc.wip_warehouse,
                            target_warehouse:frm.doc.fg_warehouse,
                        },
                        // /home/user/v15/apps/e_dispatch_automation/e_dispatch_automation/events/work_order.py
                        callback: function(r) {
                            if (!r.exc && r.message.status === "success") {
                                frappe.msgprint(`Stock Entry ${r.message.stock_entry} created successfully.`);
                                frm.reload_doc();
                            } else {
                                frappe.msgprint(r.message.message || "Failed to complete production");
                            }
                        }
                    });
                }).addClass("btn-primary");
            } else {
               
                frm.add_custom_button(__('Make QR Code'), function() {
                    frappe.call({
                        method: "e_dispatch_automation.events.work_order.make_qr_codes",
                        args: { work_order: frm.doc.name },
                        callback: function(r) {
                            if (r.message) frappe.msgprint(r.message);
                        }
                    });
                });
                // frm.add_custom_button(__('Material Transfer'), function() {
                //     frappe.call({
                //         method: "erpnext.manufacturing.doctype.work_order.work_order.make_stock_entry",
                //         args: {
                //             work_order_id: frm.doc.name,
                //             purpose: "Material Transfer for Manufacture"
                //         },
                //         callback: function(r) {
                //             if (r.message) {
                //                 var doc = frappe.model.sync(r.message);
                //                 frappe.set_route("Form", doc[0].doctype, doc[0].name);
                //             }
                //         }
                //     });
                // });
                frm.add_custom_button(__('Show Scanner'), function() {
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
                        ],
                        primary_action_label: "Log to Production",
                        primary_action: function(values) {
                            if (!values.scanned_data) {
                                frappe.msgprint("No QR code scanned.");
                                return;
                            }
                            let qr_data;
                            try {
                                qr_data = JSON.parse(values.scanned_data);
                            } catch (e) {
                                frappe.msgprint("Invalid QR data.");
                                return;
                            }
                            frappe.call({
                                method: "e_dispatch_automation.events.work_order.log_to_production",
                                args: { data: qr_data },
                                callback: function(r) {
                                    if (!r.exc) {
                                        frappe.msgprint("Logged to Production successfully.");
                                        d.hide();
                                        frm.reload_doc(); 
                                    }
                                }
                            });
                        }
                    });
                    d.show();
                    if (!window.dynamsoft_loaded) {
                        const script = document.createElement("script");
                        script.src = "https://cdn.jsdelivr.net/npm/dynamsoft-javascript-barcode@9.3.1/dist/dbr.js";
                        script.onload = () => {
                            window.dynamsoft_loaded = true;
                            initScanner(d);
                        };
                        document.body.appendChild(script);
                    } else {
                        initScanner(d);
                    }

                    d.onhide = () => {
                        if (window.scanner) {
                            window.scanner.destroyContext();
                            window.scanner = null;
                        }
                    };
                });
                async function initScanner(d) {
                    Dynamsoft.DBR.BarcodeScanner.license =
                        "DLS2eyJoYW5kc2hha2VDb2RlIjoiMTA0NDYwMDEzLU1UQTBORFl3TURFekxYZGxZaTFVY21saGJGQnliMm8iLCJtYWluU2VydmVyVVJMIjoiaHR0cHM6Ly9tZGxzLmR5bmFtc29mdG9ubGluZS5jb20iLCJvcmdhbml6YXRpb25JRCI6IjEwNDQ2MDAxMyIsInN0YW5kYnlTZXJ2ZXJVUkwiOiJodHRwczovL3NkbHMuZHluYW1zb2Z0b25saW5lLmNvbSIsImNoZWNrQ29kZSI6LTU5MTgwMDk3Mn0="; // Trial key

                    await Dynamsoft.DBR.BarcodeScanner.loadWasm();
                    window.scanner = await Dynamsoft.DBR.BarcodeScanner.createInstance();

                    const area = d.get_field("scanner_area").$wrapper[0];
                    area.innerHTML = `<div id="scanner-container" style="width:100%;height:300px;"></div>`;

                    scanner.onFrameRead = results => {
                        for (let result of results) {
                            d.set_value("scanned_data", result.barcodeText);
                        }
                    };
                    const uiElement = scanner.getUIElement();
                    uiElement.style.width = "100%";
                    uiElement.style.height = "280px";

                    area.querySelector("#scanner-container").appendChild(uiElement);

                    await scanner.open();
                }
            }
        }
    }
});
