# DeadFree – OS Synchronization & Deadlock Simulator (Frontend Only)

Open `index.html` in any modern browser. No server or build step required.

## Modules

- Banker’s Algorithm: Safety check, Need = Max − Allocation, RAG/Wait-For visualization, recovery by victim termination or resource preemption. Step-by-step tables and safe sequence.
- Reader–Writer: Reader-preference or Fair modes, aging to prevent starvation, visualization of readers/writers/waiting/starving.
- Producer–Consumer: Configurable buffer, counters (mutex/full/empty conceptual), blocking and waiting, buffer bar visualization.
- Dining Philosophers: Waiter solution, fairness with aging and starvation highlighting, circular table visualization.
- Starvation & Aging: Waiting time tracked per actor; exceeding threshold turns purple and increases priority bar until scheduled.

## Controls

- Start, Pause, Step, Reset per module
- Speed slider controls animation pace (lower is faster)
- Export Log as `.txt` or `.json`

## Notes

- All simulations are deterministic given the same inputs; randomness is limited to IDs and simple timing jitter for visualization.
- RAG uses a wait-for graph derived from unmet Needs vs Available; deadlocks draw red cycles.

## Attribution

Built for educational purposes.

