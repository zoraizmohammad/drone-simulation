# Claude Code Project Memory — Pollinator Drone Simulator

## Project Overview
A drone simulation system focused on pollinator behavior, optical flow, and Pixhawk sensor fusion. The simulation models autonomous drones navigating floral environments with realistic perception models.

## Skills Reference
Load and use all skills from `/skills/` when building this project. The master skill is:
- `/skills/pollinator-drone-simulator/SKILL.md` — composed system brain that references all sub-skills

## Active Skills
- simulation-engine
- agent-behavior-modeling
- frontend-system-design
- telemetry-dashboard
- perception-model-simulation
- state-machine-architecture
- animation-orchestration
- project-memory-manager
- pollinator-drone-simulator

## Architecture Principles
- Deterministic, time-stepped simulation loop
- Centralized simulation state; UI reads state only
- Frame index drives everything — no async randomness during replay
- Pure functions for state updates
- Pixhawk sensor fusion for realistic flight dynamics
- Optical flow as primary navigation signal

## Stack Conventions
- React + TypeScript for frontend
- Canvas/WebGL for rendering
- Custom simulation engine (no physics library unless necessary)
- Zustand or useReducer for state management

## What Claude Should Always Do
- Read all SKILL.md files before generating code
- Follow the patterns defined in each skill
- Never put logic inside UI components
- Respect the anti-patterns listed in each skill
