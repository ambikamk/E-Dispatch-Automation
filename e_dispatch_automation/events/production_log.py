import frappe

def update_scanned_qty(doc, method):
    if not doc.work_order:
        return
    total_logs = frappe.db.count("Production Log", {"work_order": doc.work_order})
    frappe.db.set_value("Work Order", doc.work_order, "custom_scanned_qty", total_logs)
