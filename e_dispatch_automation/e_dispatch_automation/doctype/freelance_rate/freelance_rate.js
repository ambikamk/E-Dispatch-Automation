// Copyright (c) 2025, craft and contributors
// For license information, please see license.txt

frappe.ui.form.on('Freelance Rate', {
    quantity: function(frm) {
        frm.trigger("calculate_total_service_charge");
    },
    service_charge: function(frm) {
        frm.trigger("calculate_total_service_charge");
    },
    calculate_total_service_charge: function(frm) {
        if (frm.doc.quantity && frm.doc.service_charge) {
            frm.set_value('total_service_charge', frm.doc.quantity * frm.doc.service_charge);
        } else {
            frm.set_value('total_service_charge', 0);
        }
    }
});
