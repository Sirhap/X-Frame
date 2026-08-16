# Direct Batch Smart Cutout Design

## Problem

Smart cutout currently enters the shared batch cutout workbench. The workbench
then owns background detection, processing, preview rendering, and the apply
step. This makes a task that should be a one-click batch operation depend on an
editing session and encourages unnecessary per-frame adjustment.

The animation organizer and the standalone batch cutout page should both apply
automatic cutout results directly to the active batch. Manual editing remains
available only when the user explicitly chooses an editing action.

## Goals

- Make the organizer's `智能抠图` action process and write back every included
  frame without opening the cutout editor.
- Make the standalone batch cutout page's automatic cutout action process the
  entire current queue directly.
- Reuse the existing background estimator, Worker transport, product cutout
  pipeline, pixel-budget partitioning, and output serialization.
- Keep `编辑抠图`, local repairs, manual color sampling, export, and project
  application available as explicit follow-up actions.
- Preserve original pixels for frames that fail or are cancelled.

## Non-goals

- Do not replace or redesign the cutout pixel algorithm.
- Do not remove the existing cutout editor or local repair controls.
- Do not change the independent scatter-slice tool's non-destructive preview
  behavior.
- Do not change project/runtime asset contracts.

## Design

### Shared direct processor

Add a small browser-side direct batch processor with no DOM or modal dependency.
It accepts a workset of image sources and returns processed outputs keyed by the
source frame identity. Its responsibilities are:

1. Validate image inputs and partition them using the existing 64 MP session
   budget.
2. Decode each frame into RGBA `ImageData` through the existing image loading
   helper.
3. Estimate a background color independently for each frame when automatic
   mode is requested.
4. Build the same processing options used by the current workbench, including
   automatic cutout activation, background samples, and the shared default
   parameters.
5. Submit the frames to the existing cutout Worker executor and collect result
   canvases plus serializable cutout state.
6. Report per-batch progress and per-frame failures without aborting unrelated
   frames.

The processor will not duplicate `BatchCutoutCore` or implement a second pixel
algorithm. It will use the current `BatchCutoutWorkerClient` and
`BatchCutoutProductCore` path so direct processing and manual preview remain
pixel-compatible.

### Organizer flow

`FrameOrganizerActions.editBatchCutout` will call the direct processor instead
of `hooks.editCutout`. Each completed batch is applied immediately through the
existing frame output update logic. The organizer remains visible and
interactive throughout processing. `editImportCutout` remains connected to the
editor workbench for intentional single-frame/local correction.

The organizer will keep its existing source order, included-frame selection,
pixel-budget partitioning, progress text, output state, and final grid/preview
refresh. A failed frame remains unchanged and is included in the final failure
summary.

### Standalone batch flow

The automatic cutout action in the standalone batch page will invoke the direct
processor for all current queue items. It will no longer toggle a canvas
sampling mode as the only way to activate automatic removal. Each frame gets
its own estimated background sample, is processed once, and is marked as an
active automatic result.

The existing editor remains available for manual background sampling, color
protection, local repair, A/B comparison, and parameter changes. Those actions
continue to invalidate and recompute results through the existing preview path.

### State and cancellation

- Direct processing publishes a result only after that frame's Worker response
  passes the existing revision check.
- A completed frame is immediately eligible for organizer/grid or queue
  rendering; later frames do not block already completed output.
- Cancellation stops scheduling new work and leaves uncompleted frames at their
  original state.
- A per-frame failure records an error without replacing its source canvas.
- Re-running smart cutout replaces only the previous automatic result and
  preserves explicit repair records unless the current workflow already marks
  them as superseded.

### UI and messaging

The existing editor layout remains intact. Labels and status messages will make
the direct behavior explicit: smart cutout is a batch action, while edit cutout
is the precision workflow. The standalone page may still expose manual sampling
and repair controls after direct processing, but those controls are not needed
for the default path.

## Testing

Add focused tests before implementation for:

- direct processing returns one output per valid workset frame and preserves
  source identity;
- organizer smart cutout does not call the editor hook, applies every completed
  output, and leaves failed frames untouched;
- standalone automatic action processes all queued items rather than only the
  selected item;
- frames are partitioned at the existing pixel budget and progress is reported
  in source order;
- cancellation and per-frame failures do not overwrite untouched frames;
- explicit editor cutout still opens the existing workbench and local repair
  behavior remains unchanged.

Run the focused direct-processing, organizer, batch-cutout, static-check, and
existing regression suites before completion.
