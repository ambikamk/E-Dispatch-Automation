import frappe
import qrcode
import io, base64, json
from frappe.utils import cstr, cint

@frappe.whitelist()
def make_qr_codes(work_order):
    wo = frappe.get_doc("Work Order", work_order)
    has_batch = frappe.db.get_value("Item", wo.production_item, "has_batch_no")
    if not has_batch:
        frappe.throw(f"Item {wo.production_item} does not have 'Has Batch No' enabled.")
    batch = frappe.new_doc("Batch")
    batch.item = wo.production_item
    batch.batch_id = wo.name
    batch.insert(ignore_permissions=True)
    qty_per_box = frappe.db.get_value("Item", wo.production_item, "qty_per_box") or 1
    no_of_qr_codes = cint(wo.qty / qty_per_box)
    for i in range(no_of_qr_codes):
        qr_code_id = f"{batch.name}-{i+1}"
        qr_data = {
            "item": wo.production_item,
            "batch_no": batch.name,
            "box_no": qr_code_id,
            "qty": qty_per_box,
            "user": frappe.session.user
        }
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=3,
            border=4,
        )
        qr.add_data(json.dumps(qr_data))
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white")
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        myimage = buffer.getvalue()

        img_data = cstr(base64.b64encode(myimage))
        img_data = "data:image/png;base64," + img_data

        batch.append("custom_qr_code", {
            "item": wo.production_item,
            "qr_code_id": qr_code_id,
            "qty": qty_per_box,
            "user": frappe.session.user,
            "content": img_data
        })
    batch.save(ignore_permissions=True)

    return f"{no_of_qr_codes} QR Codes created in Batch {batch.name} for Work Order {wo.name}"

@frappe.whitelist()
def log_to_production(data):
    """Append scanned QR data into Production Log"""
    import json
    qr_data = json.loads(data) if isinstance(data, str) else data
    work_order = qr_data.get("batch_no")
    box_no = qr_data.get("box_no")
    exists = frappe.db.exists(
        "Production Log Item",
        {
            "qr_code_id": box_no,
            "parenttype": "Production Log",
            "parentfield": "production_log_items",
        }
    )
    if exists:
        frappe.throw(f"Box {box_no} is already logged for Work Order {work_order}.")
    log = frappe.new_doc("Production Log")
    log.work_order = work_order
    log.append("production_log_items", {
        "item": qr_data.get("item"),
        "qr_code_id": box_no,
        "qty": qr_data.get("qty"),
        "user": qr_data.get("user")
    })
    log.save(ignore_permissions=True)
    frappe.db.commit()
    return "Production Log updated"

from frappe.utils import flt
@frappe.whitelist()
def complete_production(bom, work_order, scanned_qty, target_warehouse, work_in_progress_warehouse):
    """Create Stock Entry for Manufacture (with FG + Raw Materials) and update Work Order"""
    bom_doc_exists = frappe.db.exists("BOM", bom)
    if bom_doc_exists:
        stock_entry = frappe.new_doc("Stock Entry")
        stock_entry.update({
            "stock_entry_type": "Manufacture",
            "from_bom": 1,
            "work_order": work_order,
            "bom_no": bom,
            "fg_completed_qty": flt(scanned_qty),
            "to_warehouse": target_warehouse,
        })

        # Fetch BOM Items and Append to Stock Entry
        bom_items = frappe.get_all("BOM Item", filters={"parent": bom}, fields=["item_code", "qty", "stock_uom"])
        if not bom_items:
            frappe.throw(f"No items found in BOM {bom}")

        for bom_item in bom_items:
            stock_entry.append("items", {
                "item_code": bom_item.item_code,
                "qty": flt(bom_item.qty),
                "uom": bom_item.stock_uom,
                "s_warehouse": work_in_progress_warehouse,
                "t_warehouse": "",
            })

        bom_main_item, main_item_uom = frappe.get_value("BOM", bom, ['item', 'uom'])
        stock_entry.append("items", {
            "item_code": bom_main_item,
            "qty": flt(scanned_qty),
            "uom": main_item_uom,
            "s_warehouse": "",
            "t_warehouse": target_warehouse,
            "is_finished_item": 1
        })
        # bom_doc = frappe.get_doc("BOM",bom)
        # if bom_doc.scrap_items:
        #     for i in bom_doc.scrap_items:
        #         stock_entry.append("items", {
        #             "item_code": i.item_code,
        #             "qty": i.stock_qty,
        #             "uom": i.stock_uom,
        #             "s_warehouse": "",
        #             "t_warehouse": frappe.db.get_single_value("FMCG Production Settings", "default_scrap_warehouse"),
        #         })
        stock_entry.insert()
        stock_entry.submit()  # Uncomment if needed
       
        wo = frappe.get_doc("Work Order", work_order)
        wo.custom_production_completed = 1
        # wo.produced_qty = flt(wo.produced_qty) + flt(scanned_qty)
        
        # if wo.produced_qty >= wo.qty:
        #     wo.status = "Completed"
        #     wo.custom_production_completed = 1
        # wo.save(ignore_permissions=True)
        batch = frappe.get_doc("Batch",work_order)
        for row in batch.custom_qr_code:
            row.warehouse = target_warehouse
        batch.save(ignore_permissions=True)
        return {
            "status": "success",
            "stock_entry": stock_entry.name,
            "qty": flt(scanned_qty),
            "work_order_status": wo.status
        }