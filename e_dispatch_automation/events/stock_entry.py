import frappe

def update_work_order_on_submit(doc, method):
    """
    When a Stock Entry of type 'Manufacture' is submitted,
    update the linked Work Order's custom_production_completed checkbox.
    """
    if doc.stock_entry_type == "Manufacture" and doc.work_order:
        frappe.db.set_value("Work Order", doc.work_order, "custom_production_completed", 1)
        frappe.db.commit()
