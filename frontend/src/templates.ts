export const TEMPLATE_TAM_EXAMPLE = `# TAM YAML → diagrams.net (template matches tam.png)
# Do not invent new diagram aesthetics. Reuse the exact visual primitives from the example: light-gray containers, white inner boxes, pill storages, capsule carts, small junction circles, and the same edge routing style.

# Optional trust boundaries (vertical dashed regions)
# trust_boundaries:
#   - name: Cloud
#   - name: On-Premise

human_agents:
  - Customer
  - Customer (VIP)
  - Customer (Guest)

# System-side elements (first 3 populate the 3 core boxes)
agents:
  - name: customer account maintenance
  - name: product presentation + selection
  - name: order processing

storages:
  - customer data
  - product information
  - product availability
  - orders

external_providers:
  - credit card institutions
  - shipping
  - suppliers

# Communication channels (shown as the 3 customer interaction label blocks)
channels:
  - from: Customer
    to: customer account maintenance
    direction: "reqres"
    protocol: HTTPS
    label: "register / edit profile / browse orders"

  - from: Customer
    to: product presentation + selection
    direction: "reqres"
    protocol: HTTPS
    label: "search / get prod. info / select items"

  - from: Customer
    to: order processing
    direction: "reqres"
    protocol: HTTPS
    label: "place order / cancel order"

# Access links (optional; the template already draws two access flows like the example)
accesses:
  - from: customer account maintenance
    to: customer data
    access: read_write_modify_both

  - from: order processing
    to: orders
    access: read_write_modify_both
`
