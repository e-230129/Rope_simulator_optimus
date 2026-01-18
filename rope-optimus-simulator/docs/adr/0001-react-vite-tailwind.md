# ADR 0001: React + Vite + Tailwind Adoption

Date: 2025-01-18
Status: Accepted

## Context

An interactive web application is needed to visualize RoPE quantization simulation results as robot joint control.

## Decision

Adopt the following technology stack:

- **React 18**: UI component building
- **Vite**: Fast development server and build
- **TailwindCSS**: Utility-first styling
- **Recharts**: Chart rendering library

## Consequences

### Positive
- React's component model makes complex SVG animations easier to manage
- Vite's fast HMR improves development experience
- Tailwind maintains a consistent design system
- Recharts is compatible with existing code

### Negative
- React has a learning curve
- Bundle size is slightly larger

### Neutral
- TypeScript deferred for now (can be added later)

## Alternatives considered

| Option | Pros | Cons | Rejection Reason |
|--------|------|------|------------------|
| Vanilla JS | No dependencies, lightweight | Complex state management | Animation management is cumbersome |
| Vue | Lower learning curve | Recharts compatibility | Existing code assumes React |
| Svelte | Fast, lightweight | Smaller ecosystem | Limited library choices |
