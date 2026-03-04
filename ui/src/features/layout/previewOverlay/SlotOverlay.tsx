import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useParams } from 'react-router';
import { ContextMenu } from '@radix-ui/themes';

import { useAppDispatch, useAppSelector } from '@/app/hooks';
import ExposeSlotDialog from '@/features/layout/preview/ExposeSlotDialog';
import { useDataToHtmlMapValue } from '@/features/layout/preview/DataToHtmlMapContext';
import { SlotNameTag } from '@/features/layout/preview/NameTag';
import ComponentOverlay from '@/features/layout/previewOverlay/ComponentOverlay';
import EmptySlotDropZone from '@/features/layout/previewOverlay/EmptySlotDropZone';
import {
  selectEditorFrameContext,
  selectEditorViewPortScale,
  selectEditingExposedSlots,
  selectIsComponentHovered,
  selectTargetSlot,
  addExposedSlot,
  removeExposedSlot,
  selectTemplateContext,
} from '@/features/ui/uiSlice';
import useGetComponentName from '@/hooks/useGetComponentName';
import useSyncPreviewElementOffset from '@/hooks/useSyncPreviewElementOffset';
import useSyncPreviewElementSize from '@/hooks/useSyncPreviewElementSize';

import { setUpdatePreview } from '@/features/layout/layoutModelSlice';

import type React from 'react';
import type {
  ComponentNode,
  SlotNode,
} from '@/features/layout/layoutModelSlice';

import styles from './PreviewOverlay.module.css';

// import SlotDropZone from '@/features/layout/previewOverlay/SlotDropZone';

export interface SlotOverlayProps {
  slot: SlotNode;
  iframeRef: React.RefObject<HTMLIFrameElement>;
  parentComponent: ComponentNode;
  disableDrop: boolean;
  forceRecalculate?: number; // Increment this prop to trigger a re-calculation of the slot overlay's border rect
}

const SlotOverlay: React.FC<SlotOverlayProps> = (props) => {
  const {
    slot,
    parentComponent,
    iframeRef,
    disableDrop,
    forceRecalculate = 0,
  } = props;
  const dispatch = useAppDispatch();
  const { componentsMap, slotsMap } = useDataToHtmlMapValue();
  const slotId = slot.id;
  const slotElementArray = useMemo(() => {
    const element = slotsMap[slot.id]?.element;
    return element ? [element] : null;
  }, [slotsMap, slot.id]);
  const { elementRect, recalculateBorder } =
    useSyncPreviewElementSize(slotElementArray);
  const parentElementsInsideIframe =
    componentsMap[parentComponent.uuid]?.elements;
  const { offset, recalculateOffset } = useSyncPreviewElementOffset(
    slotElementArray,
    parentElementsInsideIframe ? parentElementsInsideIframe : null,
  );
  // Padding calculation (if needed for visual reasons)
  const [padding, setPadding] = useState({
    paddingTop: '0px',
    paddingBottom: '0px',
  });
  const { componentId: selectedComponent } = useParams();
  const isHovered = useAppSelector((state) => {
    return selectIsComponentHovered(state, slotId);
  });
  const targetSlot = useAppSelector(selectTargetSlot);
  const editorViewPortScale = useAppSelector(selectEditorViewPortScale);
  const editorFrameContext = useAppSelector(selectEditorFrameContext);
  const editingExposedSlots = useAppSelector(selectEditingExposedSlots);
  const templateContext = useAppSelector(selectTemplateContext);

  const isTemplateMode = editorFrameContext === 'template';
  const isSlotExposedInEditing = useMemo(() => {
    return Object.values(editingExposedSlots).some(
      (es) => es.component_uuid === parentComponent.uuid && es.slot_name === slot.name,
    );
  }, [editingExposedSlots, parentComponent.uuid, slot.name]);
  const slotIsEmpty = slot.components.length === 0;

  const isSlotExposed = useMemo(() => {
    if (!templateContext?.exposedSlots) return true;
    // In per-content editing, slots inside user-added (editable) components
    // are always droppable — only template-owned component slots are restricted.
    if (parentComponent.editable !== false) return true;
    return Object.values(templateContext.exposedSlots).some(
      (es) => es.component_uuid === parentComponent.uuid && es.slot_name === slot.name,
    );
  }, [templateContext, parentComponent.uuid, parentComponent.editable, slot.name]);

  // Exposed slot override: slot is inside a locked parent but marked exposed
  const isExposedSlotOverride = templateContext != null && isSlotExposed && parentComponent.editable === false;

  // Combined slotDisableDrop from both branches:
  // - expose-slot-dialog-ui: disable when in template mode and slot is exposed in editing
  // - per-content-editing-frontend: disable non-exposed slots; reset inherited disableDrop for exposed slots
  const slotDisableDrop = (disableDrop && !(templateContext != null && isSlotExposed))
      || (isTemplateMode && isSlotExposedInEditing)
      || (templateContext != null && !isSlotExposed);

  // Whether this slot should have pointer events enabled in per-content mode
  const isExposedInPerContentEditing = templateContext != null && isSlotExposed;

  const [exposeDialogOpen, setExposeDialogOpen] = useState(false);

  const handleExposeConfirm = useCallback(
    (machineName: string, label: string) => {
      dispatch(
        addExposedSlot({
          machineName,
          config: {
            component_uuid: parentComponent.uuid,
            slot_name: slot.name,
            label,
          },
        }),
      );
      dispatch(setUpdatePreview(true));
    },
    [dispatch, parentComponent.uuid, slot.name],
  );

  const handleRemoveExposed = useCallback(() => {
    const key = Object.entries(editingExposedSlots).find(
      ([, es]) => es.component_uuid === parentComponent.uuid && es.slot_name === slot.name,
    )?.[0];
    if (key) {
      dispatch(removeExposedSlot(key));
      dispatch(setUpdatePreview(true));
    }
  }, [dispatch, editingExposedSlots, parentComponent.uuid, slot.name]);
  const slotName = useGetComponentName(slot, parentComponent);
  const parentComponentName = useGetComponentName(parentComponent);

  const exposedSlotLabel = useMemo(() => {
    if (!isSlotExposedInEditing) return null;
    const entry = Object.values(editingExposedSlots).find(
      (es) => es.component_uuid === parentComponent.uuid && es.slot_name === slot.name,
    );
    return entry?.label ?? null;
  }, [isSlotExposedInEditing, editingExposedSlots, parentComponent.uuid, slot.name]);
  const [forceRecalculateChildren, setForceRecalculateChildren] = useState(0);

  useEffect(() => {
    const elementInsideIframe = slotsMap[slotId]?.element;
    if (elementInsideIframe) {
      const computedStyle = window.getComputedStyle(elementInsideIframe);
      setPadding({
        paddingTop: computedStyle.paddingTop,
        paddingBottom: computedStyle.paddingBottom,
      });
    }
  }, [slotsMap, slotId]);

  // Recalculate the children's borders when the elementRect changes
  useEffect(() => {
    setForceRecalculateChildren((prev) => prev + 1);
  }, [elementRect]);

  // Recalculate the border when the parent increments the forceRecalculate prop
  useEffect(() => {
    recalculateBorder();
    recalculateOffset();
  }, [forceRecalculate, recalculateBorder, recalculateOffset]);

  const style: React.CSSProperties = useMemo(
    () => ({
      height: elementRect.height * editorViewPortScale,
      width: elementRect.width * editorViewPortScale,
      top: (offset.offsetTop || 0) * editorViewPortScale,
      left: (offset.offsetLeft || 0) * editorViewPortScale,
      pointerEvents: isExposedInPerContentEditing ? 'auto' : 'none',
      ...padding,
    }),
    [
      elementRect.height,
      elementRect.width,
      editorViewPortScale,
      offset.offsetTop,
      offset.offsetLeft,
      padding,
      isExposedInPerContentEditing,
    ],
  );

  if (!slotElementArray) {
    // If we can't find the element inside the iframe, don't render the overlay.
    return null;
  }

  const slotOverlayContent = (
    <div
      aria-label={`${slotName} (${parentComponentName})`}
      className={clsx('slotOverlay', styles.slotOverlay, {
        [styles.selected]: slotId === selectedComponent,
        [styles.hovered]: isHovered,
        [styles.dropTarget]: slotId === targetSlot,
        [styles.exposed]: isTemplateMode && isSlotExposedInEditing,
        [styles.exposedPerContent]: isExposedInPerContentEditing,
        [styles.exposedPerContentOutline]: isExposedSlotOverride,
      })}
      data-canvas-type="slot"
      style={style}
    >
      {(targetSlot === slotId || isHovered) && (
        <div className={clsx(styles.canvasNameTag, styles.canvasNameTagSlot)}>
          <SlotNameTag
            name={`${slotName} (${parentComponentName})`}
            id={slotId}
            nodeType={slot.nodeType}
          />
        </div>
      )}
      {!slot.components.length && !slotDisableDrop && (
        <EmptySlotDropZone
          slot={slot}
          slotName={slotName}
          parentComponent={parentComponent}
        />
      )}
      {isTemplateMode && isSlotExposedInEditing && !slot.components.length && (
        <div className={styles.exposedSlotPlaceholder}>
          <div className={styles.exposedSlotPlaceholderLabel}>
            {exposedSlotLabel ?? slotName}
          </div>
        </div>
      )}

      {slot.components.map((childComponent: ComponentNode, index) => (
        <ComponentOverlay
          key={childComponent.uuid}
          iframeRef={iframeRef}
          parentSlot={slot}
          component={childComponent}
          index={index}
          disableDrop={slotDisableDrop}
          forceRecalculate={forceRecalculateChildren}
        />
      ))}
    </div>
  );

  if (isTemplateMode) {
    return (
      <>
        <ContextMenu.Root>
          <ContextMenu.Trigger>{slotOverlayContent}</ContextMenu.Trigger>
          <ContextMenu.Content>
            <ContextMenu.Label>{slotName}</ContextMenu.Label>
            <ContextMenu.Separator />
            {isSlotExposedInEditing ? (
              <ContextMenu.Item onClick={handleRemoveExposed}>
                Remove exposed slot
              </ContextMenu.Item>
            ) : (
              <ContextMenu.Item
                disabled={!slotIsEmpty}
                onClick={() => setExposeDialogOpen(true)}
              >
                Expose this slot
              </ContextMenu.Item>
            )}
          </ContextMenu.Content>
        </ContextMenu.Root>
        <ExposeSlotDialog
          open={exposeDialogOpen}
          onOpenChange={setExposeDialogOpen}
          onConfirm={handleExposeConfirm}
          slotName={slot.name}
        />
      </>
    );
  }

  return slotOverlayContent;
};

export default SlotOverlay;
