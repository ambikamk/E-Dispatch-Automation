frappe.listview_settings['Production Log'] = {
    onload: function(listview) {
        listview.page.add_action_item(__('Purchase Invoice'), function() {
            const selected = listview.get_checked_items();
            if (!selected.length) {
                frappe.msgprint(__('Please select at least one Production Log.'));
                return;
            }
            const selected_names = selected.map(d => d.name);
            frappe.call({
                method: "e_dispatch_automation.e_dispatch_automation.doctype.production_log.production_log.get_combined_purchase_invoice",
                args: {
                    production_logs: selected_names
                },
                callback: function(r) {
                    if (!r.exc && r.message) {
                        let doc = frappe.model.sync(r.message)[0];
                        frappe.set_route("Form", doc.doctype, doc.name);
                    }
                }
            });
        });
    }
};
