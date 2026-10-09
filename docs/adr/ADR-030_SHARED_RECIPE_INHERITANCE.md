# ADR-030: Shared recipe inheritance

## Decision

Menu Availability remains the authority for drink categories, assigned option groups, choices, and sizes. `posSettings/sharedBaseIngredients/{categoryId}` holds reusable category base quantities. A saved drink recipe stores only the shared ingredient references it uses, plus recipe-specific rows. A recipe-specific row with the same inventory item replaces the inherited row; quantities never stack.

Shared choice ingredients remain keyed to Menu Availability option groups. A drink-specific choice definition replaces the shared choice definition. Required mutually exclusive choices such as whole milk versus oat milk each contain their full ingredient quantity. Optional add-ons are costed only when selected and are shown separately from the normal base.

The browser preview and order-finalization function use the same costing resolver. Shared revisions affect future costing only. Completed orders retain their immutable inventory plan and COGS snapshot.

## Compatibility

Existing recipes remain valid and unchanged. Inheritance is opt-in per drink. Deleting or changing a shared definition does not rewrite saved recipes or historical orders; a missing selected reference produces an explicit costing warning.
