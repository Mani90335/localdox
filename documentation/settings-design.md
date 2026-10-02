# Settings

Settings opens as a modal over the current reading space. Desktop uses a grouped sidebar; screens below 640px use a full-screen dialog with a horizontally scrolling tab row. The content panel scrolls independently so the section heading and Done button remain available.

Preferences are divided into Appearance, Reading, Diagrams, Equations, and Ask AI. Workspace, Saved, and Storage form the library group. Splitting reading controls out of Appearance makes each section shorter and keeps related choices together. Theme previews use isolated palettes so both choices remain recognizable in either theme.

`SettingsPage` owns section selection and composes the existing callbacks. Individual panels update the same app preferences and workspace actions as before; closing the dialog does not commit or discard a separate settings form. Changes apply immediately. Ask AI disappears when AI features are disabled, with Appearance as the fallback for a requested AI section.

The installed MIT-licensed Radix Dialog and Tabs primitives handle focus containment, background interaction, tab relationships, arrow-key navigation, and dismissal without adding dependencies. Tab orientation follows the same breakpoint as the layout. Opening focuses the active section; closing returns focus to the invoking control when it still exists. Because Settings is also a route, `DocsApp` restores focus to the replacement Settings button after the incoming reader route finishes loading. The outgoing Settings instance skips this step so it cannot focus a button that is about to be removed. Escape cancels a workspace name draft first and otherwise closes Settings. Reduced motion disables panel fades and control transitions.

Shared sections and rows provide consistent spacing and hairline dividers. Row descriptions wrap rather than disappear behind ellipses. Font uploads, provider validation, storage protection, offline downloads, and destructive confirmations retain their existing behavior. Their errors and status messages remain inside their respective panels.

`tests/e2e/settings.spec.ts` covers keyboard navigation and dismissal, preference persistence, AI visibility, workspace draft cancellation, and layouts at desktop and narrow viewport sizes. If a control appears missing, first check the selected section and AI visibility; if an action fails, inspect its panel status and the underlying callback or service.
