// Copyright (c) 2025, craft and contributors
// For license information, please see license.txt

frappe.ui.form.on('Item Charges Mapping', {
    refresh: function(frm) {
        if (!frm.is_new()) {
            frm.add_custom_button(__('Create Freelance Rate'), function() {
                frappe.new_doc('Freelance Rate', {
                    service_item: frm.doc.service_item,
                    stock_item:frm.doc.item
                    // supplier: frm.doc.supplier
                });
            });
        }
    }
});