// Copyright (c) 2025, craft and contributors
// For license information, please see license.txt
frappe.ui.form.on("Production Log", {
    refresh: function(frm) {
        if (!frm.is_new() && frm.doc.production_log_items?.length) {
            let hasSupplierUser = false;
            frm.doc.production_log_items.forEach(row => {
                if (row.user && !hasSupplierUser) {
                    frappe.call({
                        method: "e_dispatch_automation.e_dispatch_automation.doctype.production_log.production_log.user_has_supplier_role",
                        args: { user: row.user },
                        callback: function(r) {
                            if (r.message?.has_role) {
                                hasSupplierUser = true;

                                frm.add_custom_button(__('Purchase Invoice'), function() {
                                    frappe.call({
                                        method: "e_dispatch_automation.e_dispatch_automation.doctype.production_log.production_log.create_purchase_invoice",
                                        args: { source_name: frm.doc.name },
                                        callback: function(r) {
                                            if (!r.exc && r.message) {
                                                let doc = frappe.model.sync(r.message)[0];
                                                frappe.set_route("Form", doc.doctype, doc.name);
                                            }
                                        }
                                    });
                                }, __('Create'));
                            }
                        }
                    });
                }
            });
        }
    }
});
