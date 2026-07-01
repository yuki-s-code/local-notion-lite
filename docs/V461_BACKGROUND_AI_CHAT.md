# v461 Background AI Chat

- The Workspace AI drawer remains mounted when closed, so an in-flight answer keeps running while the user opens pages, databases, tags, journals, or other screens.
- A compact status control appears above the normal AI button while an answer is in progress. Selecting it reopens the drawer.
- Closing the drawer does not cancel the request. Closing the app still ends the renderer request; persistent cross-restart AI jobs are intentionally not introduced in this version.
