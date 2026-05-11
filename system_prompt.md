# TASK — Create the SkyGate User App Start Screen

Create or update only the main `index.html` file.

This is NOT a landing page.
This is NOT a marketing hero.
This is the first functional screen of the SkyGate demo app that the user will actually use.

## Reference files

Design system:
`assets/design_system.html`

SkyGate logo:
`assets/logo.jpeg`

Target file:
`index.html`

---

# Product context

SkyGate is a mobile-first airport navigation web app.

The user can use it before arriving at the airport or while already inside the terminal.

The app helps the passenger:

- choose the journey type;
- choose where they are;
- choose where they want to go;
- enter boarding time when applicable;
- calculate estimated walking time;
- see free time before boarding;
- discover shops, cafés, pharmacies, restrooms and services on the way.

The main pain is reducing anxiety, confusion and fear of missing the flight.

---

# Main goal

Create a professional, premium, mobile-first app screen for a Fraport manager to test.

The screen must immediately show the actual route planning form.

Do not create a big marketing headline.
Do not create a landing page.
Do not create sections like benefits, about, pricing, testimonials or dashboard.

The screen should feel like:

> travel app + Google Maps + premium SaaS + mobile route planner

---

# Mandatory rules

- Follow `assets/design_system.html`.
- Reuse existing CSS classes, tokens, animations and visual patterns whenever possible.
- Use `assets/logo.jpeg` without distortion.
- Create only the first app screen in `index.html`.
- No login.
- No account creation.
- No dashboard.
- No backend.
- No extra landing page sections.
- No institutional navbar.
- Mobile is the priority.
- Desktop must also look professional.
- Keep the interface calm, clear, premium and trustworthy.

---

# Correct screen structure

## 1. Compact app header

Create a product-style header.

It must contain:

- SkyGate logo on the left;
- language selector on the right: `PT`;
- small help icon `?`.

Do not include:

- Home
- Sobre
- Preços
- Blog
- Login
- Criar conta

---

## 2. Small context area

Use a small badge:

`Demo · Aeroporto de Fortaleza`

Use a short title:

`Planeje sua rota`

Use short helper text:

`Escolha sua jornada, origem, destino e horário de embarque.`

This should be short and functional, not a big marketing hero.

---

## 3. Main route planner card

This is the most important element on the screen.

Create a premium card with the route planning inputs.

### Journey type selector

Label:

`Qual é sua jornada?`

Options:

- `Embarque`
- `Conexão`
- `Chegada final`

Use large touch-friendly segmented cards/buttons.

Default selected option:

`Conexão`

---

### Origin input

Label:

`Onde você está agora?`

Use a select/dropdown style input.

Example options:

- `Desembarque Internacional`
- `Desembarque Doméstico`
- `Check-in`
- `Raio-X`
- `Praça de Alimentação`
- `Portão 6`

Default value:

`Desembarque Internacional`

---

### Destination input

Label:

`Para onde você quer ir?`

Use a select/dropdown style input.

Example options:

- `Portão 12`
- `Bagagem`
- `Saída`
- `Banheiro`
- `Café`
- `Farmácia`

Default value:

`Portão 12`

---

### Boarding time input

Label:

`Horário de embarque`

Input value:

`14:30`

Helper text:

`Opcional para chegada final.`

---

### Primary action

Button text:

`Calcular minha rota`

This must be the main CTA.

Button requirements:

- full width on mobile;
- minimum height 48px;
- strong contrast;
- easy to tap;
- visually dominant.

Use id:

`id="calculate-route-btn"`

---

## 4. Compact result preview card

Below the form, show a compact preview/result card.

Title:

`Prévia da rota`

Route:

`Desembarque Internacional → Portão 12`

Metrics:

- `9 min` — até o portão
- `24 min` — livres antes do embarque
- `3` — serviços no caminho

Services:

`Café • Farmácia • Banheiro`

Status message:

`Você tem margem para uma parada rápida no caminho.`

Add a small route visualization:

- origin dot;
- teal/cyan route line;
- destination dot;
- small gold direction detail.

---

# Mobile layout

Mobile is the priority.

The mobile order must be:

1. compact header;
2. badge;
3. short title;
4. helper text;
5. route planner card;
6. calculate route button;
7. compact result preview card.

The route planner card must appear immediately.
The user should not feel like they are reading a landing page.

Mobile UX rules:

- large touch targets;
- short labels;
- no horizontal overflow;
- no tiny text;
- enough spacing between inputs;
- button above the preview card;
- form visible early on the screen.

---

# Desktop layout

Desktop can use two columns.

Left column:

- badge;
- short title;
- helper text;
- route planner card.

Right column:

- compact result preview card;
- route visualization;
- small metrics.

Do not make the left side a marketing section.
The form is the main content.

---

# UX principles

Apply these UX principles:

## Hick’s Law

Do not overload the user with too many choices at once.

Keep only:

- journey type;
- origin;
- destination;
- boarding time;
- calculate button.

## Fitts’s Law

Make all important touch targets large and easy to tap.

## Visual hierarchy

The hierarchy must be:

1. route planning form;
2. calculate route button;
3. route preview;
4. supporting context.

## Cognitive load reduction

The interface must reduce anxiety.

Avoid:

- huge marketing headlines;
- too much text;
- too many icons;
- excessive cards;
- exaggerated animations;
- visual clutter.

---

# Visual direction

Use the SkyGate identity:

- deep navy for main text and primary button;
- teal/cyan for route, active states and highlights;
- soft gold only for positive details;
- white/off-white/light gray background;
- rounded cards;
- subtle shadows;
- clean spacing;
- premium but functional appearance.

---

# Icons

Use subtle icons for:

- route;
- location;
- gate;
- clock;
- language;
- help;
- café;
- pharmacy;
- restroom.

Do not overuse icons.

---

# Animations

Use subtle, professional animations:

- soft entrance animation;
- card reveal;
- premium button hover;
- route line animation;
- subtle glow on active route elements;
- selected chip microinteraction.

Avoid flashy animations.

---

# Expected result

The Fraport manager must instantly understand:

1. this is the user app screen;
2. the user chooses journey, origin, destination and boarding time;
3. SkyGate calculates route, time, free time and useful services;
4. the product looks professional and testable.

Create only `index.html` with this first functional app screen.
Follow `assets/design_system.html`.
Use `assets/logo.jpeg`.