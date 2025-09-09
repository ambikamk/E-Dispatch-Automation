import frappe
from frappe.utils import flt

def update_work_order_on_submit(doc, method):
    """
    When a Stock Entry of type 'Manufacture' is submitted:
    - Mark Work Order's custom_production_completed
    - Activate the Batch with same name as Work Order
    - Update batch_qty from Stock Entry items
    """
    if doc.stock_entry_type == "Manufacture" and doc.work_order:
       
        frappe.db.set_value("Work Order", doc.work_order, "custom_production_completed", 1)

        try:
            if frappe.db.exists("Batch", doc.work_order):
                batch = frappe.get_doc("Batch", doc.work_order)
                batch.disabled = 0
                total_qty = sum(flt(item.qty) for item in doc.items if item.is_finished_item)
                batch.batch_qty = flt(total_qty)
                batch.save(ignore_permissions=True)
            else:
                frappe.log_error(f"No Batch found with name {doc.work_order}")
        except Exception as e:
            frappe.log_error(f"Batch update failed for {doc.work_order}: {str(e)}")

        frappe.db.commit()
