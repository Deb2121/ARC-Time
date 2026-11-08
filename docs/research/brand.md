# ARCnordic visual identity — research

Source: public site https://arcnordic.dk (home, /om-arcnordic-2/, /vaerdier-2/, theme stylesheets), read 2026-11-08.
These are inspiration values until official brand guidelines are supplied (see open-questions.md).

## Observed

| Token          | Value                                                                                                                       | Where seen                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Brand red      | `#CA0538`                                                                                                                   | "ARC" in the logo; links, accents, buttons, labels in site CSS (most-used colour) |
| Black          | `#000000`                                                                                                                   | "nordic" in the logo, headings                                                    |
| White          | `#FFFFFF`                                                                                                                   | backgrounds                                                                       |
| Light grey     | `#F4F4F5`                                                                                                                   | section backgrounds                                                               |
| Body text grey | `#4A4A4A`                                                                                                                   | child-theme body text                                                             |
| Fonts          | Open Sans 300/400/600/700 (Google Fonts); Arial/Helvetica fallback                                                          | site CSS                                                                          |
| Logo           | Wordmark "ARCnordic": "ARC" crimson, "nordic" black, geometric sans; byline "Arkitekter \| Ingeniører \| Bygherrerådgivere" | logo PNG                                                                          |
| Shapes         | Pill buttons (large radius), otherwise square-ish (2px)                                                                     | site CSS                                                                          |
| Tone           | Warm, plain, reassuring Danish ("Vi gør det nemmere at være bygherre"); trust, collaboration, "family"                      | page copy                                                                         |

Business: multidisciplinary consultancy (architects, engineers, client advisers), founded 1986, Glentevej 69a, 2400 København NV.

## Derived design direction for ARCnordic Tid [Assumed]

- **Calm, Nordic, data-dense.** Mostly white/neutral surfaces; red used sparingly for primary actions, focus and brand moments — never for large areas, and never as the sole error colour (errors need an icon + text so red brand ≠ red error).
- Palette (to be validated for WCAG AA in M0):
  - `brand-600 #CA0538` (primary), `brand-700 #A8042E` (hover), `brand-50 #FCE8EE` (tint)
  - neutrals: `#0B0B0C` ink, `#4A4A4A` text, `#71717A` muted, `#E4E4E7` border, `#F4F4F5` surface-alt, `#FFFFFF` surface
  - status (distinct from brand): success `#1F7A4D`, warning `#B26A00`, danger `#B42318` (with icon), info `#1D5FA8`
  - heatmap: under-booked cool neutral/blue, 70–100 % green, >100 % amber→deep orange (not brand red)
- Typography: **Open Sans** for UI/body (matches site), a free geometric sans for headings/wordmark echo (candidate: **Jost**), tabular numerals for all figures.
- Dark mode: V2.
