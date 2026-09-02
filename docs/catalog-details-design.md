# CCTI Catalog Details Design

## Confirmed coverage

CCTI has **35 tools for this computer** in seven groups and **145 Convex packages for one selected project** in eleven groups. The existing canonical records reliably provide an ID, name, category, source or package identity, install action, and selected platform notes. They do not provide enough everyday-language decision guidance for a first-time computer user.

## Required explanation record

Every catalog item needs the following fields in the desktop app.

| Field | Plain-language purpose |
|---|---|
| What it helps with | A short explanation of the job the item can help with. |
| Choose this when | A real decision that makes the item a reasonable choice. |
| Example | One simple situation where a person might use it. |
| Where it goes | **This computer** for Claude Code tools, or **This project** for Convex packages. |
| What CCTI does | The reviewed action CCTI can perform after confirmation. |
| You may still need to | An honest follow-up for sign-in, keys, licenses, platform limits, or item-specific configuration. |

The compact card should show the first two ideas in short form. An accessible **Details** control must reveal the complete record before a person adds the item to a plan. Details must never imply that opening or reading them selects or installs anything.

## Current integration points

The main tool cards currently show technical classification and action text. The component cards show a package name and an install command, while their right-side **Details** area has only package and source information. The renderer must load the checked `catalog-details.json` lookup, use its purpose on each compact card, and show the full shared explanation record in a Details area. The existing On/Off switches and **Add to project plan** checkboxes remain separate controls.

The desktop package must include the checked detail dataset. The normal desktop validation command must fail if an item is missing its detail record, if a card loses its Details control, or if an explanation detail view can change a selection.

The main process already reads the tool and component catalogs through static resource helpers, while tool selection and component-plan changes have separate explicit handlers. The detail dataset must follow the same read-only resource pattern. Reading a detail can never call an install, add an item to a plan, or open a project folder.

For packaged builds, `catalog-details.json` must be included beside the existing tool and component catalogs in the app resources. The preload bridge will expose only a `getCatalogDetails` read operation. The renderer will use the returned records only to label cards and render Details content.

The checked dataset now has one record for every canonical ID. The detail validator enforces 35 computer tools, 145 project components, unique IDs, correct scope, a plain purpose, a choose-when decision, an example, an honest CCTI action, a follow-up boundary, and packaged-resource inclusion.

The compact card now shows the item name, where it goes, what it helps with, and a choice cue. Its **Details and example** disclosure uses the full six-part explanation. The switch remains the only control that turns a computer-level item on or off. In the component library, **Details** remains read-only and **Add to project plan** remains the only selection control.

## Safety boundary

Explanations describe what the catalog record supports. CCTI may prepare supported safe prerequisites and install an approved package or tool, but it does not invent project configuration, supply credentials, accept terms, buy services, or claim that an external setup step is complete.
