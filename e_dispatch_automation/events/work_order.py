import frappe
import qrcode
import io, base64, json
from frappe.utils import cstr, cint, nowdate, nowtime
from frappe.utils import flt

from barcode import Code128
from barcode.writer import ImageWriter

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
            "user": frappe.session.user,
            "fg_warehouse":wo.fg_warehouse
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
            "content": img_data,
            "fg_warehouse":wo.fg_warehouse
        })
    batch.save(ignore_permissions=True)

    return f"{no_of_qr_codes} QR Codes created in Batch {batch.name} for Work Order {wo.name}"


# @frappe.whitelist()
# def make_qr_codes(work_order):
#     wo = frappe.get_doc("Work Order", work_order)
#     has_batch = frappe.db.get_value("Item", wo.production_item, "has_batch_no")
#     if not has_batch:
#         frappe.throw(f"Item {wo.production_item} does not have 'Has Batch No' enabled.")

#     batch = frappe.new_doc("Batch")
#     batch.item = wo.production_item
#     batch.batch_id = wo.name
#     batch.insert(ignore_permissions=True)

#     qty_per_box = frappe.db.get_value("Item", wo.production_item, "qty_per_box") or 1
#     no_of_codes = cint(wo.qty / qty_per_box)

#     for i in range(no_of_codes):
#         qr_code_id = f"{batch.name}-{i+1}"
#         qr_data = {
#             "item": wo.production_item,
#             "batch_no": batch.name,
#             "box_no": qr_code_id,
#             "qty": qty_per_box,
#             "user": frappe.session.user,
#             "fg_warehouse": wo.fg_warehouse
#         }

#         # ----------------- QR Code -----------------
#         qr = qrcode.QRCode(
#             version=1,
#             error_correction=qrcode.constants.ERROR_CORRECT_L,
#             box_size=3,
#             border=4,
#         )
#         qr.add_data(json.dumps(qr_data))
#         qr.make(fit=True)

#         qr_img = qr.make_image(fill_color="black", back_color="white")
#         buffer_qr = io.BytesIO()
#         qr_img.save(buffer_qr, format="PNG")
#         qr_image_data = "data:image/png;base64," + cstr(base64.b64encode(buffer_qr.getvalue()))

#         # ----------------- Barcode (Code128) -----------------
#         barcode_buffer = io.BytesIO()
#         # Store the same JSON text as in QR (so scanning works identically)
#         barcode_text = json.dumps(qr_code_id)
#         barcode_obj = Code128(barcode_text, writer=ImageWriter())
#         barcode_obj.write(barcode_buffer, options={
#             "module_width": 0.4,   # thickness of bars
#             "module_height": 15.0, # height of bars
#             "font_size": 8,        # text font below barcode
#             "quiet_zone": 2.0      # blank space around barcode
#         })
#         barcode_image_data = "data:image/png;base64," + cstr(base64.b64encode(barcode_buffer.getvalue()))

#         # ----------------- Append to Batch -----------------
#         batch.append("custom_qr_code", {
#             "item": wo.production_item,
#             "qr_code_id": qr_code_id,
#             "qty": qty_per_box,
#             "user": frappe.session.user,
#             "content": qr_image_data,# QR code image
#             "barcode_content": barcode_image_data,# New barcode image
#             "fg_warehouse": wo.fg_warehouse
#         })

#     batch.save(ignore_permissions=True)
#     return f"{no_of_codes} QR + Barcode created in Batch {batch.name} for Work Order {wo.name}"

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
        batch = frappe.get_doc("Batch",work_order)
        bom_main_item, main_item_uom = frappe.get_value("BOM", bom, ['item', 'uom'])
        stock_entry.append("items", {
            "item_code": bom_main_item,
            "qty": flt(scanned_qty),
            "uom": main_item_uom,
            "s_warehouse": "",
            "t_warehouse": target_warehouse,
            "is_finished_item": 1,
            "use_serial_batch_fields":1,
            "batch_no":batch.name
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
        stock_entry.submit()
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
        batch.disabled = 0
        batch.batch_qty = flt(scanned_qty)
        batch.save(ignore_permissions=True)
        return {
            "status": "success",
            "stock_entry": stock_entry.name,
            "qty": flt(scanned_qty),
            "work_order_status": wo.status
        }

@frappe.whitelist()
def custom_make_stock_entry(work_order_id, purpose="Manufacture", items=None):
    if isinstance(items, str):
        items = json.loads(items)

    work_order_id = frappe.form_dict.get("work_order_id")
    purpose = frappe.form_dict.get("purpose", "Manufacture")

    # Fetch Work Order
    wo = frappe.get_doc("Work Order", work_order_id)
    fg_warehouse = wo.fg_warehouse

    # Get items from client
    items_from_client = frappe.form_dict.get("items")
    if isinstance(items_from_client, str):
        items_from_client = json.loads(items_from_client)

    # Fetch all Work Order Items
    wo_items = frappe.get_all(
        "Work Order Item",
        filters={"parent": work_order_id},
        fields=["item_code", "transferred_qty", "custom_transferred_qty", "stock_uom", "source_warehouse"]
    )
    if not wo_items:
        frappe.throw("No items found in this Work Order.")
    # Merge quantities
    # Merge quantities without using next()
    items_to_transfer = []
    for row in wo_items:
        # Find matching item from client
        client_row = None
        for i in items_from_client:
            if i["item_code"] == row["item_code"]:
                client_row = i
                break
        # Decide quantity: use custom_transferred_qty if exists, else transferred_qty
        qty = 0
        if client_row and client_row.get("custom_transferred_qty", 0) > 0:
            qty = client_row["custom_transferred_qty"]
        else:
            qty = row.get("transferred_qty", 0)
        items_to_transfer.append({
            "item_code": row["item_code"],
            "qty": qty,
            "uom": row["stock_uom"],
            "s_warehouse": row["source_warehouse"]
        })
    # Create Stock Entry
    se = frappe.new_doc("Stock Entry")
    se.stock_entry_type = purpose
    se.work_order = work_order_id
    se.company = wo.company
    se.from_bom = 1
    se.bom_no = wo.bom_no
    se.fg_completed_qty = wo.qty
    se.use_multi_level_bom = wo.use_multi_level_bom

    # Append Raw Materials
    for item in items_to_transfer:
        se.append("items", {
            "item_code": item["item_code"],
            "qty": item["qty"],
            "uom": item["uom"],
            "s_warehouse": item["s_warehouse"],
            "t_warehouse": None
        })

    # Append Finished Good
    se.append("items", {
        "item_code": wo.production_item,
        "qty": wo.qty,
        "uom": wo.stock_uom,
        "s_warehouse": None,
        "t_warehouse": fg_warehouse
    })

    se.insert()
    se.submit()

    frappe.response["message"] = se.name

@frappe.whitelist()
def create_return_stock_entry(work_order, item_code, qty, source_wh, target_wh):
    try:
        qty = float(qty)
        if not qty or qty <= 0:
            return {"error": "Quantity must be greater than 0"}
        # Fetch Work Order to validate
        wo = frappe.get_doc("Work Order", work_order)
        if not source_wh:
            return {"error": "Source Warehouse not specified"}
        if not target_wh:
            return {"error": "Target Warehouse not specified"}

        # --- Determine which batch to return ---
        batch_to_use = None
        # Check if any Stock Entry exists with change_batch (alternate batch case)
        se_name = frappe.db.exists(
            "Stock Entry",
            {"work_order": work_order, "docstatus": 1, "stock_entry_type": "Material Transfer"}
        )
        if se_name:
            se_doc = frappe.get_doc("Stock Entry", se_name)
            for item in se_doc.items:
                if item.item_code == item_code and item.batch_no:
                    # Use the last batch moved for this item (changed batch if applicable)
                    batch_to_use = item.batch_no

        # Fallback: if no batch found, take from Work Order Item
        if not batch_to_use:
            for row in wo.required_items:
                if row.item_code == item_code and row.batch_no:
                    batch_to_use = row.batch_no
                    break

        # --- Create Return Stock Entry ---
        se = frappe.new_doc("Stock Entry")
        se.stock_entry_type = "Material Transfer"
        se.work_order = work_order
        se.company = wo.company
        se.posting_date = nowdate()
        se.append("items", {
            "item_code": item_code,
            "qty": qty,
            "s_warehouse": source_wh,
            "t_warehouse": target_wh,
            "use_serial_batch_fields": 1,
            "batch_no": batch_to_use
        })
        se.insert(ignore_permissions=True)
        se.submit()

        return {"name": se.name, "batch_used": batch_to_use}

    except Exception as e:
        return {"error": str(e)}

@frappe.whitelist()
def retake_item_and_create_stockentry(work_order, item_code, current_batch, qty, change_batch):

    wo = frappe.get_doc("Work Order", work_order)

    # Determine which batch to use
    if str(change_batch) in ["1", "true", "True"]:

        used_batches = []
        # Check if a Stock Entry exists
        se_name = frappe.db.exists({
            "doctype": "Stock Entry",
            "work_order": work_order,
            "docstatus": 1,
            "stock_entry_type": "Material Transfer for Manufacture"
        })
        if se_name:
            se_doc = frappe.get_doc("Stock Entry", se_name)
            for item in se_doc.items:
                if item.item_code == item_code and item.serial_and_batch_bundle:
                    # Get batch numbers from Serial and Batch Bundle
                    bundle_doc = frappe.get_doc("Serial and Batch Bundle", item.serial_and_batch_bundle)
                    for e in bundle_doc.entries:
                        if e.batch_no:
                            used_batches.append(e.batch_no)
        # if current_batch:
        #     used_batches.append(current_batch)
        # Pick an alternate batch
        available_batches = frappe.get_all(
            "Batch",
            filters={
                "item": item_code,
                "name": ["not in", used_batches]
            },
            fields=["name"],
            limit=1
        )
        if not available_batches:
            frappe.throw(f"No alternate batch available for {item_code}")

        batch_to_use = available_batches[0].name
    else:
        # Use same batch
        batch_to_use = current_batch

    # Create Stock Entry
    se = frappe.new_doc("Stock Entry")
    se.stock_entry_type = "Material Transfer"
    se.work_order = work_order
    se.company = wo.company
    se.posting_date = nowdate()
    se.append("items", {
        "item_code": item_code,
        "qty": qty,
        "s_warehouse": wo.wip_warehouse,
        "t_warehouse": wo.source_warehouse,
        "use_serial_batch_fields": 1,
        "batch_no": batch_to_use
    })
    se.insert(ignore_permissions=True)
    se.submit()

    # Update custom_transferred_qty in Work Order child table
    for row in wo.required_items:
        if row.item_code == item_code:
            new_val = (row.custom_transferred_qty or row.transferred_qty) - float(qty)
            frappe.db.set_value("Work Order Item", row.name, "custom_transferred_qty", new_val)

    if str(change_batch) in ["1", "true", "True"]:
        return f"Stock Entry {se.name} created with alternate batch {batch_to_use}"
    else:
        return f"Stock Entry {se.name} created with same batch {batch_to_use}"


@frappe.whitelist()
def retake_multiple_items_and_create_stockentries(work_order, items):
    import json
    if isinstance(items, str):
        items = json.loads(items)

    wo = frappe.get_doc("Work Order", work_order)
    messages = []

    # Create one stock entry for all items
    se = frappe.new_doc("Stock Entry")
    se.stock_entry_type = "Material Transfer"
    se.work_order = work_order
    se.company = wo.company
    se.posting_date = nowdate()

    for row in items:
        item_code = row.get("item_code")
        current_batch = row.get("batch")
        qty = float(row.get("qty") or 0)
        change_batch = row.get("change_batch")

        if not item_code or qty <= 0:
            continue

        # Determine which batch to use
        if str(change_batch) in ["1", "true", "True"]:
            used_batches = []

            se_name = frappe.db.exists(
                "Stock Entry",
                {"work_order": work_order, "docstatus": 1, "stock_entry_type": "Material Transfer for Manufacture"},
            )
            if se_name:
                se_doc = frappe.get_doc("Stock Entry", se_name)
                for item in se_doc.items:
                    if item.item_code == item_code and item.serial_and_batch_bundle:
                        bundle_doc = frappe.get_doc("Serial and Batch Bundle", item.serial_and_batch_bundle)
                        for e in bundle_doc.entries:
                            if e.batch_no:
                                used_batches.append(e.batch_no)

            available_batches = frappe.get_all(
                "Batch",
                filters={"item": item_code, "name": ["not in", used_batches]},
                fields=["name"],
                limit=1,
            )
            if not available_batches:
                frappe.throw(f"No alternate batch available for {item_code}")
            batch_to_use = available_batches[0].name
        else:
            batch_to_use = current_batch

        # Append item
        se.append(
            "items",
            {
                "item_code": item_code,
                "qty": qty,
                "s_warehouse": wo.wip_warehouse,
                "t_warehouse": wo.source_warehouse,
                "use_serial_batch_fields": 1,
                "batch_no": batch_to_use,
            },
        )

        # Update transferred qty
        for w_item in wo.required_items:
            if w_item.item_code == item_code:
                new_val = max((w_item.custom_transferred_qty or w_item.transferred_qty) - qty, 0)
                frappe.db.set_value("Work Order Item", w_item.name, "custom_transferred_qty", new_val)

        if str(change_batch) in ["1", "true", "True"]:
            messages.append(f"{item_code}: alternate batch {batch_to_use}")
        else:
            messages.append(f"{item_code}: same batch {batch_to_use}")

    # Save once
    if se.items:
        se.insert(ignore_permissions=True)
        se.submit()
        messages.insert(0, f"Stock Entry {se.name} created successfully")

    return "\n".join(messages)
