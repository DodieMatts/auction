# Manual Accessibility Checklist

Automated Axe scans cover serious and critical accessibility violations, but they do not prove complete accessibility. Use this checklist before release-level changes.

## Landmarks And Structure

- Confirm every primary page has clear `header`, `nav`, `main`, and relevant form landmarks.
- Confirm heading order is logical and does not skip levels for visual styling.
- Confirm page titles and visible headings describe the current task.

## Keyboard Navigation

- Navigate login, administrator auction creation, lifecycle actions, bidder commitment, receipt actions, reveal import, and logout without a mouse.
- Confirm focus order follows the visual order.
- Confirm focus is always visible.
- Confirm no keyboard trap exists in confirmations or receipt panels.

## Forms And Announcements

- Confirm every input has a visible label.
- Confirm validation errors are associated with the relevant task.
- Confirm success and failure messages are announced through live regions when appropriate.
- Confirm file upload controls remain keyboard accessible.

## Mobile And Zoom

- Test narrow mobile width and 200% browser zoom.
- Confirm navigation remains reachable.
- Confirm forms and receipt actions wrap without horizontal scrolling.
- Confirm date, currency, and status text remains readable.

## Color And Motion

- Confirm status meaning is communicated with text or symbols, not color alone.
- Confirm success green, warning orange, danger red, and neutral states remain distinguishable.
- Confirm reduced-motion settings do not hide information.

## Receipt Security Messaging

- Confirm bidders are warned to save reveal receipts immediately.
- Confirm lost receipt consequences are understandable.
- Confirm secrets are not displayed unless the user deliberately reveals sensitive receipt content.

## Error Recovery

- Confirm expired-session, conflict, unavailable-backend, and invalid-receipt states explain the next action.
- Confirm users can retry or refresh without losing unrelated page context.
