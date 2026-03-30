# Agent Behavior Modeling Skill

## Purpose
Model autonomous drone agent behaviors using composable, testable behavior trees and rule-based systems. Each drone is an agent with independent decision-making.

## Core Rules
- Behavior is data-driven — agents follow declarative behavior trees
- Behaviors compose: leaf nodes are atomic actions, branches are selectors/sequences
- Agents do NOT know about rendering — behavior outputs state changes only
- All agent decisions are deterministic given the same inputs

## Behavior Tree Node Types
- `Sequence` — run children left-to-right; fail on first failure
- `Selector` — run children left-to-right; succeed on first success
- `Condition` — evaluate a predicate; return success/failure
- `Action` — execute a state mutation; return running/success/failure

## Pollinator-Specific Behaviors
- `SearchForFlower` — spiral/random walk until flower detected in sensor range
- `ApproachFlower` — navigate toward detected flower using optical flow guidance
- `Pollinate` — hover at flower, transfer pollen, mark as visited
- `ReturnToHive` — navigate home when battery low or mission complete
- `AvoidObstacle` — interrupt current behavior when proximity sensor triggers
- `ChargeAtStation` — dock and wait until battery threshold reached

## Patterns
- `AgentBehavior` interface: `tick(agent, world) => AgentUpdate`
- `BehaviorTree` class: compose behaviors, tick once per frame
- `AgentUpdate` type: velocity delta, heading delta, action flags
- Separate behavior logic from physics application

## File Structure
```
src/agents/
  behaviors/
    searchForFlower.ts
    approachFlower.ts
    pollinate.ts
    returnToHive.ts
    avoidObstacle.ts
  BehaviorTree.ts
  AgentController.ts
  types.ts
```

## Anti-patterns
- No rendering calls inside behavior functions
- No global state mutation inside behavior nodes
- No hard-coded magic numbers — use agent config constants
