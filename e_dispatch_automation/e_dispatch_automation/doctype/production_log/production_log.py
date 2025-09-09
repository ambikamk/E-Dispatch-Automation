import frappe
from frappe.model.document import Document

class ProductionLog(Document):
    def validate(self):
        self.append_freelance_rates()

    def append_freelance_rates(self):
        if not self.production_log_items:
            return
        for row in self.production_log_items:
            user = row.user
            item = row.item

            if not user or not item:
                continue

            if "Supplier" not in frappe.get_roles(user):
                continue

            supplier = frappe.get_value("Supplier", {"custom_freelance_user": user}, "name")
            if supplier:
                self.supplier = supplier
            if not supplier:
                continue

            freelance_rates = frappe.get_all(
                "Freelance Rate",
                filters={
                    "stock_item": item,
                    "supplier": supplier
                },
                fields=["service_item", "supplier", "service_charge","total_service_charge"]
            )
            for rate in freelance_rates:
                exists = any(
                    d.service_item == rate.service_item and d.supplier == rate.supplier
                    for d in self.service_item
                )
                if not exists:
                    self.append("service_item", {
                        "service_item": rate.service_item,
                        "supplier": rate.supplier,
                        "rate":rate.service_charge,
                        "amount": rate.total_service_charge
                    })
@frappe.whitelist()
def user_has_supplier_role(user):
    """Return True if user has Supplier role, else False."""
    roles = frappe.get_roles(user)
    return {"has_role": "Supplier" in roles}

import frappe
from frappe.model.mapper import get_mapped_doc

@frappe.whitelist()
def create_purchase_invoice(source_name, target_doc=None):
    print("created")
    """Map Production Log to Sales Invoice with child items."""
    doc = get_mapped_doc(
        "Production Log",
        source_name,
        {
            "Production Log": {
                "doctype": "Purchase Invoice",
                "field_map": {
                   "supplier":"supplier",
                    # "customer": "customer",
                    # "customer_name": "customer_name",
                    "posting_date": "posting_date",
                    # "company": "company"
                }
            },
            # "Production Log Item": {
            #     "doctype": "Purchase Invoice Item",
            #     "field_map": {
            #         "item": "item_code",
            #         # "description": "description",
            #         # "uom": "uom",
            #         # "qty": "qty"
            #     }
            # },
            "Service Item": {
                "doctype": "Purchase Invoice Item",
                "field_map": {
                    "service_item": "item_code",
                    # "description": "description",
                    # "uom": "uom",
                    "qty": 1
                }
            }
        },
        target_doc
    )
    return doc

@frappe.whitelist()
def get_combined_purchase_invoice(production_logs):
    """
    Create a single Sales Invoice draft with aggregated service items
    from selected Production Logs.
    """
    import json
    if isinstance(production_logs, str):
        production_logs = json.loads(production_logs)

    si = frappe.new_doc("Purchase Invoice")
   
    si.posting_date = frappe.utils.today()

    service_items = {}

    for pl_name in production_logs:
        pl = frappe.get_doc("Production Log", pl_name)
        si.supplier = pl.supplier
       
        if hasattr(pl, "service_item"):
            for s_item in pl.service_item:
                item_code = s_item.service_item
                qty = s_item.qty if hasattr(s_item, "qty") and s_item.qty else 1
                rate = s_item.rate if hasattr(s_item, "rate") and s_item.rate else 0
                # amount = qty * rate

                if item_code in service_items:
                    service_items[item_code]["qty"] += qty
                    # service_items[item_code]["amount"] += amount
                else:
                    service_items[item_code] = {
                        "item_code": item_code,
                        "qty": qty,
                        "rate": rate,
                        # "amount": amount
                    }

    
    for item_data in service_items.values():
        si.append("items", {
            "item_code": item_data["item_code"],
            "qty": item_data["qty"],
            "uom":"Nos",
            "rate": item_data["rate"]
        })

    return si.as_dict()
