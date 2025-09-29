frappe.ui.form.on('Work Order', {
    refresh: function(frm) {
        // if (frm.is_new()) return;

        //CASE 1: QR Code based production is enabled
        if (frm.doc.custom_qr_code_based_production) {
            // frm.remove_custom_button(__('Start'));
            frm.remove_custom_button(__('Finish'));
            if (frm.doc.custom_production_completed) return;
            if (frm.doc.custom_scanned_qty == frm.doc.qty) {
                frm.add_custom_button("Complete Production", function() {
                    frappe.call({
                        method: "e_dispatch_automation.events.work_order.complete_production", 
                        args: {
                            bom: frm.doc.bom_no,
                            work_order: frm.doc.name,
                            scanned_qty: frm.doc.custom_scanned_qty,
                            work_in_progress_warehouse: frm.doc.wip_warehouse,
                            target_warehouse: frm.doc.fg_warehouse,
                        },
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
                            { fieldname: "scanner_area", label: "QR Scanner", fieldtype: "HTML" },
                            { fieldname: "scanned_data", label: "Scanned Data", fieldtype: "Small Text", read_only: 1 }
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
                                args: {data: qr_data},
                                callback: function(r){
                                    if (!r.exc) {
                                        frappe.msgprint("Logged to Production successfully.");
                                        d.hide();
                                        setTimeout(() => {
                                            window.location.reload();
                                        },500);
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
                        "DLS2eyJoYW5kc2hha2VDb2RlIjoiMTA0NDYwMDEzLU1UQTBORFl3TURFekxYZGxZaTFVY21saGJGQnliMm8iLCJtYWluU2VydmVyVVJMIjoiaHR0cHM6Ly9tZGxzLmR5bmFtc29mdG9ubGluZS5jb20iLCJvcmdhbml6YXRpb25JRCI6IjEwNDQ2MDAxMyIsInN0YW5kYnlTZXJ2ZXJVUkwiOiJodHRwczovL3NkbHMuZHluYW1zb2Z0b25saW5lLmNvbSIsImNoZWNrQ29kZSI6LTU5MTgwMDk3Mn0=";

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
        //CASE 2: QR Code based production is NOT enabled
        else {
           frappe.db.get_value("Stock Entry", {
                work_order: frm.doc.name,
                docstatus: 1,
                stock_entry_type: "Material Transfer for Manufacture"
            }, "name").then(r => {
                if (!r || !r.message || !r.message.name) return;

                frm.add_custom_button(__('Re-take Items'), function() {
                    if (!frm.doc.required_items || frm.doc.required_items.length === 0) {
                        frappe.msgprint(__('No required items found'));
                        return;
                    }

                    let items = frm.doc.required_items.map(r => ({
                        item_code: r.item_code,
                        required_qty: Number(r.required_qty) || 0,
                        consumed_qty: Number(r.consumed_qty) || 0,
                        transferred_qty: Number(r.custom_transferred_qty || r.transferred_qty) || 0,
                        name: r.name
                    }));
                    let options = items.map(i => i.item_code).join('\n');

                    const d = new frappe.ui.Dialog({
                        title: 'Re-take Item',
                        fields: [
                            { fieldname: 'item', fieldtype: 'Select', label: 'Select Item', options: options, reqd: 1 },
                            { fieldname: 'batch', fieldtype: 'Select', label: 'Current Batch (Info)', options: [], read_only: 0 },
                            { fieldname: 'current_transferred', fieldtype: 'Float', label: 'Current Transferred Qty', read_only: 1 },
                            { fieldname: 'qty', fieldtype: 'Float', label: 'Quantity to Take', reqd: 1 },
                            { fieldname: 'balance_after', fieldtype: 'Float', label: 'Balance After Taking', read_only: 1 },
                            { fieldname: 'change_batch', fieldtype: 'Check', label: 'Change Batch?', default: 0 }
                        ],
                        primary_action_label: 'Submit',
                        primary_action(values) {
                            const row = items.find(i => i.item_code === values.item);
                            if (!row) return;
                            let take_qty = Number(values.qty) || 0;
                            if (take_qty <= 0 || take_qty > row.transferred_qty) {
                                frappe.msgprint("Invalid quantity");
                                return;
                            }

                    if (values.change_batch) {
                        frappe.call({
                            method: "e_dispatch_automation.events.work_order.retake_item_and_create_stockentry",
                            args: {
                                work_order: frm.doc.name,
                                item_code: values.item,
                                current_batch: values.batch,
                                qty: take_qty,
                                change_batch: 1
                            },
                            callback: function(r) {
                                if (r.message) {
                                    frappe.msgprint(r.message);
                                    frm.reload_doc();
                                }
                            }
                        });
                    } else {
                        // call same server method, just with change_batch = 0
                        frappe.call({
                            method: "e_dispatch_automation.events.work_order.retake_item_and_create_stockentry",
                            args: {
                                work_order: frm.doc.name,
                                item_code: values.item,
                                current_batch: values.batch,
                                qty: take_qty,
                                change_batch: 0
                            },
                            callback: function(r) {
                                if (r.message) {
                                    frappe.msgprint(r.message);
                                    frm.reload_doc();
                                }
                            }
                        });
                    }
                    d.hide();
                        }
                    });
                    // When item changes → fetch batch info
                    d.fields_dict.item.$input.on('change', function() {
                        const sel = d.get_value('item');
                        const row = items.find(i => i.item_code === sel);
                        if (row) {
                            d.set_value('current_transferred', row.transferred_qty);
                            d.set_value('balance_after', row.transferred_qty);

                            frappe.db.get_value("Stock Entry", {
                                work_order: frm.doc.name,
                                docstatus: 1,
                                stock_entry_type: "Material Transfer for Manufacture"
                            }, "name").then(se => {
                                if (se && se.message && se.message.name) {
                                    frappe.db.get_doc("Stock Entry", se.message.name).then(se_doc => {
                                        let batches = [];
                                        (se_doc.items || []).forEach(it => {
                                            if (it.item_code === row.item_code && it.serial_and_batch_bundle) {
                                                frappe.db.get_doc("Serial and Batch Bundle", it.serial_and_batch_bundle).then(bundle => {
                                                    (bundle.entries || []).forEach(e => {
                                                        if (e.batch_no) batches.push(e.batch_no);
                                                    });
                                                    if (batches.length) {
                                                        d.set_df_property('batch', 'options', batches);
                                                        d.set_value('batch', batches[0]);
                                                    }
                                                });
                                            }
                                        });
                                    });
                                }
                            });
                        }
                    });

                    d.fields_dict.qty.$input.on('input', function() {
                        const sel = d.get_value('item');
                        const row = items.find(i => i.item_code === sel);
                        if (row) {
                            let take_qty = Number(d.get_value('qty')) || 0;
                            d.set_value('balance_after', Math.max(row.transferred_qty - take_qty, 0));
                        }
                    });

                    d.show();
                }, __("Custom Actions"));

                // ---------------- Re-take Multiple Items ----------------
                frm.add_custom_button(__('Re-take Multiple Items'), function() {
                    if (!frm.doc.required_items || frm.doc.required_items.length === 0) return;

                    // Map existing items
                    let items = frm.doc.required_items.map(r => ({
                        item_code: r.item_code,
                        transferred_qty: Number(r.custom_transferred_qty || r.transferred_qty) || 0,
                        name: r.name
                    }));

                    const d = new frappe.ui.Dialog({
                        title: 'Re-take Multiple Items',
                        size: 'extra-large',
                        fields: [
                            {
                                fieldname: 'items_table',
                                fieldtype: 'Table',
                                label: 'Re-take Items',
                                in_place_edit: true,
                                cannot_add_rows: false,
                                data: [],
                                get_data: function() {
                                    return this.data;
                                },
                                fields: [
                                    {
                                        fieldname: 'item_code',
                                        fieldtype: 'Select',
                                        label: 'Item',
                                        options: items.map(i => i.item_code).join('\n'),
                                        in_list_view: 1,
                                        reqd: 1,
                                        columns: 1,
                                        onchange: function() {
                                            let data = d.get_value('items_table') || [];
                                            data.forEach(row => {
                                                let item = items.find(i => i.item_code === row.item_code);
                                                if (item) {
                                                    row.current_transferred = item.transferred_qty;
                                                    let take_qty = Number(row.qty) || 0;
                                                    row.balance_after = Math.max(item.transferred_qty - take_qty, 0);

                                                    // Fetch available batches for this item
                                                    frappe.db.get_value("Stock Entry", {
                                                        work_order: frm.doc.name,
                                                        docstatus: 1,
                                                        stock_entry_type: "Material Transfer for Manufacture"
                                                    }, "name").then(se => {
                                                        if (se && se.message && se.message.name) {
                                                            frappe.db.get_doc("Stock Entry", se.message.name).then(se_doc => {
                                                                let batches = [];
                                                                (se_doc.items || []).forEach(it => {
                                                                    if (it.item_code === row.item_code && it.serial_and_batch_bundle) {
                                                                        frappe.db.get_doc("Serial and Batch Bundle", it.serial_and_batch_bundle).then(bundle => {
                                                                            (bundle.entries || []).forEach(e => {
                                                                                if (e.batch_no) batches.push(e.batch_no);
                                                                            });
                                                                            if (batches.length) {
                                                                                // Update only this row's batch field
                                                                                let grid_row = d.fields_dict.items_table.grid.grid_rows_by_docname[row.name];
                                                                                if (grid_row) {
                                                                                    let batch_field = grid_row.get_field('batch');
                                                                                    if (batch_field) {
                                                                                        batch_field.df.options = batches;
                                                                                        if (!row.batch) {
                                                                                            row.batch = batches[0];
                                                                                        }
                                                                                        grid_row.refresh_field('batch');
                                                                                    }
                                                                                }
                                                                            }
                                                                        });
                                                                    }
                                                                });
                                                            });
                                                        }
                                                    });
                                                }
                                            });
                                            d.fields_dict.items_table.grid.refresh();
                                        }
                                    },
                                    { fieldname: 'batch', fieldtype: 'Select', label: 'Batch', in_list_view: 1, columns: 1 },
                                    { fieldname: 'change_batch', fieldtype: 'Check', label: 'Change Batch?', in_list_view: 1, default: 0, columns: 2 },
                                    { fieldname: 'current_transferred', fieldtype: 'Float', label: 'Current Transferred Qty', read_only: 1, in_list_view: 1 },
                                    { fieldname: 'qty', fieldtype: 'Float', label: 'Quantity to Take', in_list_view: 1, reqd: 1, columns: 1 },
                                    { fieldname: 'balance_after', fieldtype: 'Float', label: 'Balance After Taking', read_only: 1, in_list_view: 1, columns: 1 }
                                ]
                            }
                        ],
                        primary_action_label: 'Submit',
                        primary_action(values) {
                            let rows = values.items_table || [];

                            //  Only keep valid rows
                            let valid_rows = rows.filter(r => {
                                let row_data = items.find(i => i.item_code === r.item_code);
                                let take_qty = Number(r.qty) || 0;
                                return row_data && take_qty > 0 && take_qty <= row_data.transferred_qty;
                            });

                            if (!valid_rows.length) {
                                frappe.msgprint("No valid items selected.");
                                return;
                            }

                            // Call backend once with all valid rows
                            frappe.call({
                                method: "e_dispatch_automation.events.work_order.retake_multiple_items_and_create_stockentries",
                                args: {
                                    work_order: frm.doc.name,
                                    items: valid_rows
                                },
                                callback: function(res) {
                                    if (res.message) {
                                        frappe.msgprint(res.message);
                                        frm.reload_doc();
                                    }
                                }
                            });

                            frm.refresh_field('required_items');
                            d.hide();
                        }
                    });

                    // Add one blank row to start with
                    d.fields_dict.items_table.df.data.push({});
                    d.fields_dict.items_table.grid.refresh();

                    // Extra bit: Watch qty changes to recalc balance_after
                    $(d.fields_dict.items_table.grid.wrapper).on('change', 'input[data-fieldname="qty"]', function() {
                        let data = d.get_value('items_table') || [];
                        data.forEach(row => {
                            let item = items.find(i => i.item_code === row.item_code);
                            if (item) {
                                row.current_transferred = item.transferred_qty;
                                let take_qty = Number(row.qty) || 0;
                                row.balance_after = Math.max(item.transferred_qty - take_qty, 0);
                            }
                        });
                        d.fields_dict.items_table.grid.refresh();
                    });
                    d.show();
                }, __("Custom Actions"));

                frm.add_custom_button(__('Return Item'), function(){
                    if (!frm.doc.required_items || frm.doc.required_items.length === 0) {
                        frappe.msgprint(__('No items to return'));
                        return;
                    }
                    let items = frm.doc.required_items
                        .filter(r => (r.required_qty || 0) > (r.custom_transferred_qty || r.transferred_qty || 0))
                        .map(r => ({
                            item_code: r.item_code,
                            required_qty: Number(r.required_qty) || 0,
                            transferred_qty: Number(r.custom_transferred_qty || r.transferred_qty) || 0,
                            name: r.name
                        }));
                    if (items.length === 0) {
                        frappe.msgprint(__('No retaken items available to return'));
                        return;
                    }
                    const options = items.map(i => i.item_code).join('\n');
                    const d = new frappe.ui.Dialog({
                        title: 'Return Item',
                        fields: [
                            { fieldname: 'item', fieldtype: 'Select',label: 'Select Item', options: options, reqd: 1},
                            { fieldname: 'available', fieldtype: 'Float', label: 'Transferred Qty', read_only: 1 },
                            { fieldname: 'qty', fieldtype: 'Float',label: 'Quantity to Return', reqd: 1 },
                            { fieldname: 'balance_after', fieldtype: 'Float', label: 'Balance After Return', read_only: 1 }
                        ],
                        primary_action_label: 'Submit',
                        primary_action(values) {
                            const row = items.find(i => i.item_code === values.item);
                            if (!row) return;
                            const return_qty = Number(values.qty) || 0;
                            const available = row.required_qty - row.transferred_qty;

                            if (return_qty <= 0 || return_qty > available) {
                                frappe.msgprint("Invalid return quantity");
                                return;
                            }
                            // Update Required Items table
                            let target_row = frm.doc.required_items.find(r => r.item_code === row.item_code);
                            if (target_row) {
                                let new_val = (target_row.custom_transferred_qty || target_row.transferred_qty || 0) + return_qty;
                                target_row.custom_transferred_qty = new_val;

                                // update in DB
                                frappe.db.set_value("Work Order Item", target_row.name, "custom_transferred_qty", new_val);
                            }
                            frm.refresh_field('required_items');
                            frappe.msgprint(__("Return recorded in Required Items."));
                            const wip_wh = frm.doc.wip_warehouse;
                            function make_stock_entry(source_wh) {
                                frappe.call({
                                    method: "e_dispatch_automation.events.work_order.create_return_stock_entry",
                                    args: {
                                        work_order: frm.doc.name,
                                        item_code: row.item_code,
                                        qty: return_qty,
                                        source_wh: source_wh,
                                        target_wh: wip_wh
                                    },
                                    callback: function(r) {
                                        if (r.message) {
                                            if (r.message.name) {
                                                frappe.msgprint(__(
                                                    "Stock Entry created: <a href='/app/stock-entry/" +
                                                    r.message.name + "'>" + r.message.name + "</a>"
                                                ));
                                                frappe.set_route("Form", "Stock Entry", r.message.name);
                                            } else if (r.message.error) {
                                                frappe.msgprint("Stock Entry creation failed: " + r.message.error);
                                            }
                                        } else {
                                            frappe.msgprint("Stock Entry creation failed: Unknown error");
                                        }
                                    }
                                });
                            }
                            if (!frm.doc.source_warehouse) {
                                frappe.prompt([
                                    {
                                        fieldname: "source_wh",
                                        fieldtype: "Link",
                                        options: "Warehouse",
                                        label: "Select Source Warehouse",
                                        reqd: 1
                                    }
                                ], function(data) {
                                    make_stock_entry(data.source_wh);
                                }, __("Missing Source Warehouse"), __("Proceed"));
                            } else {
                                make_stock_entry(frm.doc.source_warehouse);
                            }
                            d.hide();
                        }
                    });
                    // Update available and balance_after fields
                    d.fields_dict.item.$input.on('change', function() {
                        const sel = d.get_value('item');
                        const row = items.find(i => i.item_code === sel);
                        if (row) {
                            const available = row.required_qty - row.transferred_qty;
                            d.set_value('available', available);
                            d.set_value('balance_after', available);
                        }
                    });

                    d.fields_dict.qty.$input.on('input', function() {
                        const sel = d.get_value('item');
                        const row = items.find(i => i.item_code === sel);
                        const qty = Number(d.get_value('qty')) || 0;
                        if (row) {
                            const available = row.required_qty - row.transferred_qty;
                            d.set_value('balance_after', Math.max(available - qty, 0));
                        }
                    });

                    d.show();
                }, __("Custom Actions"));
                //----------------Finish Button ----------------//
                frm.remove_custom_button(__('Finish'));
                let btn = frm.add_custom_button(__('Finish custom'), function() {
                    frappe.confirm(__('Are you sure you want to finish this Work Order?'), function() {
                        let items_to_send = (frm.doc.required_items || []).map(row => ({
                            name: row.name,
                            item_code: row.item_code,
                            custom_transferred_qty: row.custom_transferred_qty || 0,
                            source_warehouse: row.source_warehouse,
                            stock_uom: row.stock_uom,
                            required_qty: row.required_qty
                        }));
                        let has_retaken = items_to_send.some(r => r.custom_transferred_qty > 0);
                        if (!has_retaken) {
                            frappe.call({
                                method: "e_dispatch_automation.events.work_order.custom_make_stock_entry",
                                args: { work_order_id: frm.doc.name, purpose: "Manufacture", items: items_to_send },
                                freeze: true, freeze_message: __("Creating Stock Entry...")
                            }).then(r => {
                                if (r.message) frappe.set_route("Form", "Stock Entry", r.message);
                                else frappe.msgprint(__('Could not create Stock Entry.'));
                            });
                            return;
                        }
                        frappe.call({
                            method: "e_dispatch_automation.events.work_order.custom_make_stock_entry",
                            args: { work_order_id: frm.doc.name, purpose: "Manufacture", items: items_to_send.filter(r => r.custom_transferred_qty > 0) },
                            freeze: true, freeze_message: __("Creating Stock Entry...")
                        }).then(r => {
                            if (r.message) frappe.set_route("Form", "Stock Entry", r.message);
                            else frappe.msgprint(__('Could not create Stock Entry.'));
                        });
                    });
                });
                $(btn).css({ 'background-color': 'black', 'color': 'white', 'border': '1px solid black' });
            });
        }
    }
});
