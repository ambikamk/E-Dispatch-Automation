import frappe

def set_item_no_from_picklist(doc, method):
    """Set item_no in Delivery Note Items based on Pick List Locations batch_no."""
    pick_list_rows = frappe.get_all(
        "Pick List Item",
        filters={"parent": doc.pick_list},
        fields=["batch_no", "item_no"]
    )
    batch_to_itemno = {row.batch_no: row.item_no for row in pick_list_rows if row.batch_no}
    for item in doc.items:
        if item.batch_no and item.batch_no in batch_to_itemno:
            item.item_no = batch_to_itemno[item.batch_no]


def delete_qr_codes_on_submit(doc, method):
    """Delete QR codes (case-insensitive) from Batch.custom_qr_code table on DN submit."""
    for item in doc.items:
        if not item.batch_no or not item.item_no:
            continue
        qr_ids = [q.strip().upper() for q in item.item_no.split(",") if q.strip()]
        qr_rows = frappe.get_all(
            "Production Log Item",
            filters={"parent": item.batch_no},
            fields=["name", "qr_code_id"]
        )
        for row in qr_rows:
            if row.qr_code_id and row.qr_code_id.upper() in qr_ids:
                frappe.delete_doc("Production Log Item", row.name, ignore_permissions=True)
                frappe.log_error(
                    f"Deleted QR {row.qr_code_id} from Batch {item.batch_no}",
                    "Delivery Note QR Delete"
                )
