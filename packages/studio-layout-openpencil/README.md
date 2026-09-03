# Studio Layout OpenPencil Adapter

Isolated compiler and binding adapter targeting the transactional OpenPencil `batch_design` surface.

This package does not install OpenPencil, write `.op` files, persist production state, or call a model. It compiles deterministic operations and validates execution results supplied by a future external executor.
