# TASK — Refine SkyGate Route Result Experience

Update only `index.html`.

The current SkyGate app screen is already visually good and functional.  
Now refine the result experience after the user clicks `Calcular minha rota`.

The goal is to make the MVP feel more interactive, professional and closer to a real airport navigation app.

This is NOT a landing page.  
This is the functional user app screen.

Use:

- `assets/design_system.html` as the visual reference
- `assets/logo.jpeg` as the SkyGate logo
- existing styles, colors, classes and animations whenever possible

---

# Current Problem

After the user clicks `Calcular minha rota`, the app currently shows too much information at once:

- route summary
- map
- step-by-step instructions
- services list

This makes the screen feel less interactive and a bit heavy.

The result should feel more like a real app:

- first show the route summary and map;
- let the user interact with the map;
- let the user open service details by tapping service icons;
- let the user start the guide manually;
- reveal step-by-step instructions only when needed.

---

# Main UX Goal

Use progressive disclosure.

After calculation, do NOT show everything at once.

Show the most important information first:

1. route summary;
2. visual map;
3. services as clickable markers on the map;
4. primary action: `Iniciar guia`.

Then reveal extra details only after interaction.

---

# Required Result Flow

## State 1 — Before calculation

Keep the current form:

- journey type selector;
- origin select;
- destination select;
- boarding time input;
- button `Calcular minha rota`.

Do not show route result before the user clicks the button.

---

## State 2 — After clicking `Calcular minha rota`

Show the result area with:

### 1. Route summary card

Show:

- `Rota calculada`
- `Raio-X / Segurança → Portão 12`
- `9 min até o portão`
- `24 min livres`
- `3 serviços no caminho`
- status message:
  `Você tem margem para uma parada rápida no caminho.`

Keep this card compact.

---

### 2. Interactive schematic map

Show a visual schematic airport map.

The map must not feel like a static image.

It should include:

- light airport floor background;
- corridor shapes/grid;
- animated teal/cyan route line;
- origin marker;
- destination marker;
- service markers along the route:
  - Café
  - Farmácia
  - Banheiro
- soft glow on active route;
- labels that are readable on mobile.

Service markers must be clickable.

When the user taps/clicks a service marker, open a bottom sheet or floating detail card.

---

# Service Marker Interaction

When clicking `Café`, show a mobile-friendly bottom sheet/card:

Title:
`Café`

Content:
`No caminho até o portão`

Extra info:
`+1 min de desvio`

Description:
`Boa opção se você tiver mais de 15 minutos livres.`

Button:
`Adicionar parada`

---

When clicking `Farmácia`, show:

Title:
`Farmácia`

Content:
`No caminho até o portão`

Extra info:
`0 min de desvio`

Description:
`Útil para compras rápidas antes do embarque.`

Button:
`Adicionar parada`

---

When clicking `Banheiro`, show:

Title:
`Banheiro`

Content:
`No caminho até o portão`

Extra info:
`0 min de desvio`

Description:
`Localizado antes da chegada ao Portão 12.`

Button:
`Ver no mapa`

---

# Services List Behavior

Do NOT show the full services list immediately as a big section.

Instead:

- show services primarily as clickable markers on the map;
- optionally show a compact row of chips below the map:
  - `Café`
  - `Farmácia`
  - `Banheiro`

The detailed service card should appear only after clicking a marker or chip.

---

# Step-by-Step Behavior

Do NOT show the full “Passo a passo” section immediately.

Instead, show a button after the map:

`Iniciar guia`

When the user clicks `Iniciar guia`, reveal the step-by-step guide.

The guide should work like a simulated navigation mode.

Show one step at a time, not all steps at once.

## Guide steps

Step 1:

Title:
`Saia do raio-x / segurança`

Description:
`Siga pelo corredor principal.`

Time:
`1 min`

---

Step 2:

Title:
`Passe pela área de serviços`

Description:
`Café, farmácia e banheiro estão no caminho.`

Time:
`5 min`

---

Step 3:

Title:
`Continue até o Portão 12`

Description:
`Tempo estimado restante: 6 min.`

Time:
`6 min`

---

# Guide Interaction

When the guide starts:

Show:

- current step number;
- title;
- description;
- estimated time;
- button `Próxima etapa`.

When clicking `Próxima etapa`, advance to the next step.

When the guide reaches the final step, show:

`Você chegou próximo ao Portão 12.`

Button:
`Finalizar guia`

This is a simulated guide because the MVP does not have real-time indoor location yet.

Do not pretend there is live GPS tracking.

---

# Map Interaction

The map should visually react when the guide step changes.

For example:

- highlight the current segment of the route;
- slightly pulse the current marker;
- keep the animation subtle.

Do not make it look like a game.

It should feel like a premium navigation interface.

---

# Mobile UX Rules

Mobile is the priority.

On mobile:

- route summary appears first after calculation;
- map appears immediately after summary;
- `Iniciar guia` button appears under the map;
- bottom sheet must be easy to close;
- service details must not cover the entire screen permanently;
- buttons must be at least 48px high;
- no horizontal overflow;
- no tiny labels.

The result should feel interactive but still calm.

---

# Desktop UX Rules

On desktop:

- form can stay on the left;
- result/map can appear on the right;
- bottom sheet can become a floating detail card;
- guide can appear below or beside the map.

Keep the layout clean.

---

# Visual Direction

Keep the existing SkyGate visual identity:

- deep navy for primary text/buttons;
- teal/cyan for route line, active states and service markers;
- soft gold only for positive highlights and direction details;
- white/off-white/light gray background;
- rounded cards;
- subtle shadows;
- premium but functional UI.

Avoid:

- excessive neon;
- dark cyberpunk map;
- fake 3D map that looks unrelated;
- too much animation;
- too many cards visible at once;
- landing page sections.

---

# JavaScript Requirements

Use vanilla JavaScript.

Required behaviors:

1. clicking `Calcular minha rota` shows the result section;
2. result section scrolls into view smoothly;
3. clicking service markers opens service detail bottom sheet/card;
4. clicking close hides service detail;
5. clicking `Iniciar guia` starts the simulated guide;
6. clicking `Próxima etapa` advances guide steps;
7. clicking `Finalizar guia` closes/resets guide state;
8. selected journey type still updates active state;
9. if journey is `Chegada final`, boarding time should look optional/less emphasized.

---

# Expected Final Experience

The Fraport manager should be able to:

1. fill the route form;
2. click `Calcular minha rota`;
3. see a clean route summary;
4. see a visual interactive airport map;
5. tap services on the route;
6. open service details;
7. start a simulated step-by-step guide;
8. understand clearly how SkyGate would work in a real airport.

The result should feel like a real MVP, not a static mockup.

Edit only `index.html`.
Do not create backend.
Do not create login.
Do not create dashboard.
Do not create landing page sections.