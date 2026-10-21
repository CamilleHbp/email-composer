---
name: Mail Studio
description: An everyday editing workspace that keeps the email visually dominant.
colors:
  primary: "#285745"
  primary-hover: "#1c4434"
  ink: "#273d35"
  muted: "#607068"
  workspace: "#e9ede7"
  navigation: "#f0f3ec"
  page: "#f7f8f5"
  paper: "#fff"
  panel: "#fafbf8"
  border: "#dce3dd"
  field-border: "#ccd6ce"
  control-hover: "#f1f5ef"
  control-hover-border: "#afc1b2"
  selection: "#547b50"
  accent: "#bc5d35"
  nav-active: "#dfe8d7"
  nav-active-ink: "#234b38"
  preview: "#edf0e9"
  segmented: "#dfe6db"
typography:
  headline:
    fontFamily: '"DM Sans Variable", sans-serif'
    fontSize: "38px"
    fontWeight: 580
    lineHeight: 1.12
    letterSpacing: "-.035em"
  title:
    fontFamily: '"DM Sans Variable", sans-serif'
    fontSize: "17px"
    fontWeight: 650
    letterSpacing: "-.015em"
  card-title:
    fontFamily: '"DM Sans Variable", sans-serif'
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: '"DM Sans Variable", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: '"DM Sans Variable", sans-serif'
    fontSize: "12px"
    fontWeight: 600
  control:
    fontFamily: '"DM Sans Variable", sans-serif'
    fontSize: "14px"
    fontWeight: 550
    lineHeight: 1.35
rounded:
  field: "6px"
  control: "7px"
  starter: "8px"
  floating: "9px"
  preview: "10px"
  dialog: "14px"
spacing:
  compact: "4px"
  icon-gap: "8px"
  field-gap: "12px"
  group: "16px"
  section: "20px"
  dialog: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  button-secondary-hover:
    backgroundColor: "{colors.control-hover}"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 0"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "9px 10px"
  navigation-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.nav-active-ink}"
    rounded: "{rounded.control}"
    padding: "11px 13px"
  design-preview:
    backgroundColor: "{colors.preview}"
    rounded: "{rounded.preview}"
    padding: "22px 25px 0"
    height: "210px"
  segmented:
    backgroundColor: "{colors.segmented}"
    rounded: "{rounded.control}"
    padding: "3px"
  dialog:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    padding: "24px"
---

# Design System: Mail Studio

## Overview

**Creative North Star: "Everyday Editing Workspace"**

Mail Studio is a compact, calm editing workspace. Green-tinted surfaces and dark
ink frame white email paper; the document remains visually dominant. The same
restrained controls carry through the library, editor, and dialogs.

The library gives documents room to be recognized through thumbnails. Editing
puts compact tools beside a scrollable canvas, with explicit selection and
continuously visible save status. Paper illustration on the sign-in screen adds
warmth without becoming decorative chrome throughout the application.

**Key Characteristics:**
- Green-tinted neutral surfaces with a deep green action color.
- Self-hosted DM Sans, compact controls, and clear document hierarchy.
- Tonal separation, fine borders, and softly raised document paper.
- Lucide line icons and visible keyboard focus.

## Colors

A muted botanical palette separates tools, workspace, and paper. Frontmatter
values define the shared palette.

### Primary
- **Deep Green** (`primary`): primary actions, field focus, active tabs, and carets.
- **Deep Green Hover** (`primary-hover`): primary button hover state.
- **Selection Green** (`selection`): selected canvas outline and its drag handle.

### Secondary
- **Clay** (`accent`): the small brand dot and paper illustration accent.

### Neutral
- **Ink** and **Muted**: primary content and supporting labels.
- **Workspace**, **Navigation**, and **Page**: the three surrounding surface tones.
- **Paper** and **Panel**: white document/control surfaces and gently tinted tools.
- **Border** and **Field Border**: dividers, container edges, and form boundaries.
- **Control Hover** and **Control Hover Border**: quiet interaction feedback.
- **Navigation Active** and **Navigation Active Ink**: current library destination.
- **Preview** and **Segmented**: thumbnail framing and preview-mode tracks.

**The Document First Rule.** Keep the paper distinct from surrounding green-tinted
surfaces, and reserve the strong green fill for actions and selected controls.

## Typography

DM Sans Variable is the self-hosted application face. Headings use modest weight
changes and tighter tracking; labels remain compact and sentence case. Email
output retains its mail-compatible Arial/Helvetica/sans-serif stack.

The headline role introduces the library; titles organize sections, card titles
name documents, body text explains actions, and labels identify fields. Controls
use their own slightly stronger weight and tighter line height. Inspector labels
and tab text are smaller (11px), with form values at (12px). Library headlines
reduce to (30px) at the narrow layout breakpoint. Sign-in typography is larger
than the working interface, and dialog headings sit between section and page
headings.

**The Content Boundary Rule.** Application typography styles the editing tools;
the email's own content and compatible output styles determine the document.

## Layout

The library uses a persistent sidebar (228px) and a main region capped at
(1800px), with six starter previews and three document columns. At wide widths
(1500px and above), documents use four columns. At widths up to (1150px), the
sidebar narrows to (205px), starters use three columns, and documents use two.

The desktop editor fills the viewport. Its palette, flexible workspace, and
inspector use columns of (210px / flexible / 265px), expanding to
(230px / flexible / 290px) at the wide breakpoint and contracting to
(175px / flexible / 230px) at the intermediate breakpoint. Panels scroll
independently. The canvas toolbar stays at the top of the workspace while the
email scrolls below it.

At widths up to (760px), library navigation moves above content and wraps.
Editor panels stack; the block palette scrolls horizontally and the email
workspace keeps its own scrolling region. The document's preview width remains
independent of the application viewport. Fields normally use a two-column grid,
while compact related controls and actions share rows. Use the spacing roles for
small control gaps, field groups, and dialog interiors.

## Elevation & Depth

Tonal surfaces and fine borders establish most separation. Soft shadows lift
email paper and transient feedback; dialogs use a deeper diffuse shadow and a
dimmed backdrop. Library document previews remain flat within their bordered
frames. The sign-in illustration uses lightly rotated paper layers.

**The Quiet Depth Rule.** Keep routine navigation and form controls flat; use
soft elevation for document paper and overlays.

## Shapes

Corners are gently rounded. Fields are the tightest control shape; buttons and
segmented controls share a slightly softer corner. Starter previews, floating
feedback, document previews, and dialogs increase rounding according to the
frontmatter roles. Dividers remain thin and straight. Circular avatars and the
small brand dot are intentional exceptions to the rectangular control language.

## Components

### Buttons

Compact, legible actions combine text and Lucide line icons with the icon-gap
spacing. Primary actions use deep green with white text; secondary actions use
paper, ink, and a fine border. Icon buttons have transparent backgrounds and no
border; text buttons use smaller text and minimal horizontal padding. Hover
changes the surface and border, while keyboard focus has a (2px) green outline
with (3px) offset. Disabled buttons reduce opacity and use the default cursor.
Background and border transitions last (150ms).

### Inputs / Fields

White fields have a fine field border, field-radius corners, and a persistent
label above. Focus changes the border to deep green and retains visible keyboard
focus. Textareas support vertical resizing. Related numeric controls align in a
grid, and suffixes remain inside their field boundary.

### Navigation

Library destinations use full-width, left-aligned icon-and-label buttons with
quiet default text. The current destination receives a green-tinted fill and
deeper text. Editor tabs use a bottom rule to identify the active panel; layers
use a tinted row to identify the selected node. Narrow layouts wrap library
navigation and center editor tabs.

### Cards / Containers

A document card pairs a bordered preview frame with its title, supporting
metadata, and compact actions below. The preview has rounded corners and clips
its miniature email; the surrounding card has no enclosing border or shadow.
Starter previews use a tighter frame and subtle individual surface tints.

### Segmented Preview Controls

A tinted rounded track groups the device or output choices. The active option
uses white paper and green text. Keep preview mode visually separate from
editing commands.

### Canvas Selection

Selected nodes have an inward (2px) green outline. A matching handle sits above
the node and appears on selection or keyboard focus. Hover gives unselected nodes
a lighter outline. Empty image and container targets use dashed boundaries to
show where content can be placed. Move controls in the inspector provide keyboard
alternatives to dragging.

### Dialogs and Feedback

Dialogs use a softly tinted panel, generous rounding, a title and labeled close
button, and a dimmed backdrop. The standard width is capped at (480px), wide
previews at (1000px), and both retain (16px) viewport margins. Inline notices
carry status or errors near the relevant controls; temporary toasts sit near the
bottom center. Recovery and export errors present concrete actions. Motion is
removed when reduced motion is requested.

## Do's and Don'ts

### Do:
- **Do** keep the email visually dominant and its width meaningful within the scrollable workspace.
- **Do** reuse deep green actions, tinted tool surfaces, and white document paper.
- **Do** preserve explicit selection, visible focus, labeled icon controls, and keyboard alternatives to dragging.
- **Do** allow English and French labels to fit the same compact interface.
- **Do** distinguish save status and actionable errors from ordinary supporting text.

### Don't:
- **Don't** replace Lucide line icons with decorative glyph substitutes.
- **Don't** give routine controls the shadows reserved for paper and overlays.
- **Don't** apply application type styling to exported email content.
- **Don't** remove focus or selection cues to make the interface appear cleaner.
