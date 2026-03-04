import { useCallback, useMemo, useState } from 'react';
import { CollapsibleContent } from '@radix-ui/react-collapsible';
import * as Collapsible from '@radix-ui/react-collapsible';
import { TriangleDownIcon, TriangleRightIcon } from '@radix-ui/react-icons';
import { Box, DropdownMenu, Flex } from '@radix-ui/themes';

import { useAppDispatch, useAppSelector } from '@/app/hooks';
import SidebarNode from '@/components/sidePanel/SidebarNode';
import ExposeSlotDialog from '@/features/layout/preview/ExposeSlotDialog';
import ComponentLayer from '@/features/layout/layers/ComponentLayer';
import LayersDropZone from '@/features/layout/layers/LayersDropZone';
import {
  addExposedSlot,
  removeExposedSlot,
  selectCollapsedLayers,
  selectEditorFrameContext,
  selectEditingExposedSlots,
  selectTemplateContext,
  setHoveredComponent,
  toggleCollapsedLayer,
  unsetHoveredComponent,
} from '@/features/ui/uiSlice';
import useGetComponentName from '@/hooks/useGetComponentName';

import type React from 'react';
import type { CollapsibleTriggerProps } from '@radix-ui/react-collapsible';
import type {
  ComponentNode,
  SlotNode,
} from '@/features/layout/layoutModelSlice';

interface SlotLayerProps {
  slot: SlotNode;
  children?: false | React.ReactElement<CollapsibleTriggerProps>;
  indent: number;
  parentNode?: ComponentNode;
  disableDrop?: boolean;
}

const SlotLayer: React.FC<SlotLayerProps> = ({
  slot,
  indent,
  parentNode,
  disableDrop = false,
}) => {
  const dispatch = useAppDispatch();
  const slotName = useGetComponentName(slot, parentNode);
  const collapsedLayers = useAppSelector(selectCollapsedLayers);
  const editorFrameContext = useAppSelector(selectEditorFrameContext);
  const editingExposedSlots = useAppSelector(selectEditingExposedSlots);
  const templateContext = useAppSelector(selectTemplateContext);

  const isTemplateMode = editorFrameContext === 'template';
  const isSlotExposedInEditing = useMemo(() => {
    return Object.values(editingExposedSlots).some(
      (es) => parentNode && es.component_uuid === parentNode.uuid && es.slot_name === slot.name,
    );
  }, [editingExposedSlots, parentNode, slot.name]);
  const slotIsEmpty = slot.components.length === 0;

  const isSlotExposed = useMemo(() => {
    if (!templateContext?.exposedSlots) return true;
    // In per-content editing, slots inside user-added (editable) components
    // are always droppable — only template-owned component slots are restricted.
    if (parentNode && parentNode.editable !== false) return true;
    return Object.values(templateContext.exposedSlots).some(
      (es) => parentNode && es.component_uuid === parentNode.uuid && es.slot_name === slot.name,
    );
  }, [templateContext, parentNode, slot.name]);

  // Exposed slot override: slot is inside a locked parent but marked exposed
  const isExposedSlotOverride = templateContext != null && isSlotExposed && parentNode?.editable === false;

  // Combined slotDisableDrop from both branches:
  // - expose-slot-dialog-ui: disable when in template mode and slot is exposed in editing
  // - per-content-editing-frontend: disable non-exposed slots; reset inherited disableDrop for exposed slots
  const slotDisableDrop = (disableDrop && !(templateContext != null && isSlotExposed))
      || (isTemplateMode && isSlotExposedInEditing)
      || (templateContext != null && !isSlotExposed);
  const slotId = slot.id;
  const isCollapsed = collapsedLayers.includes(slotId);

  const [exposeDialogOpen, setExposeDialogOpen] = useState(false);

  const handleExposeConfirm = useCallback(
    (machineName: string, label: string) => {
      if (!parentNode) return;
      dispatch(
        addExposedSlot({
          machineName,
          config: {
            component_uuid: parentNode.uuid,
            slot_name: slot.name,
            label,
          },
        }),
      );
    },
    [dispatch, parentNode, slot.name],
  );

  const handleRemoveExposed = useCallback(() => {
    const key = Object.entries(editingExposedSlots).find(
      ([, es]) => parentNode && es.component_uuid === parentNode.uuid && es.slot_name === slot.name,
    )?.[0];
    if (key) {
      dispatch(removeExposedSlot(key));
    }
  }, [dispatch, editingExposedSlots, parentNode, slot.name]);

  const handleItemMouseEnter = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      dispatch(setHoveredComponent(slotId));
    },
    [dispatch, slotId],
  );

  const handleItemMouseLeave = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      dispatch(unsetHoveredComponent());
    },
    [dispatch],
  );

  const handleOpenChange = () => {
    dispatch(toggleCollapsedLayer(slotId));
  };

  return (
    <Box
      data-canvas-uuid={slotId}
      data-canvas-type={slot.nodeType}
      aria-labelledby={`layer-${slotId}-name`}
      position="relative"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <Collapsible.Root
        className="canvas--collapsible-root"
        open={!isCollapsed}
        onOpenChange={handleOpenChange}
        data-canvas-uuid={slotId}
      >
        <SidebarNode
          id={`layer-${slotId}-name`}
          onMouseEnter={handleItemMouseEnter}
          onMouseLeave={handleItemMouseLeave}
          title={isSlotExposedInEditing ? `${slotName} (exposed)` : slotName}
          draggable={false}
          variant="slot"
          open={!isCollapsed}
          disabled={slotDisableDrop}
          indent={indent}
          dropdownMenuContent={
            isTemplateMode ? (
              <DropdownMenu.Content>
                <DropdownMenu.Label>{slotName}</DropdownMenu.Label>
                <DropdownMenu.Separator />
                {isSlotExposedInEditing ? (
                  <DropdownMenu.Item onClick={handleRemoveExposed}>
                    Remove exposed slot
                  </DropdownMenu.Item>
                ) : (
                  <DropdownMenu.Item
                    disabled={!slotIsEmpty}
                    onClick={() => setExposeDialogOpen(true)}
                  >
                    Expose this slot
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.Content>
            ) : undefined
          }
          leadingContent={
            <Flex>
              <Box width="var(--space-4)" mr="1">
                {slot.components.length > 0 ? (
                  <Box>
                    <Collapsible.Trigger
                      asChild={true}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <button
                        aria-label={
                          isCollapsed ? `Expand slot` : `Collapse slot`
                        }
                      >
                        {isCollapsed ? (
                          <TriangleRightIcon />
                        ) : (
                          <TriangleDownIcon />
                        )}
                      </button>
                    </Collapsible.Trigger>
                  </Box>
                ) : (
                  <Box />
                )}
              </Box>
            </Flex>
          }
        />

        {slot.components.length > 0 && (
          <CollapsibleContent role="tree">
            {slot.components.map((component, index) => (
              <ComponentLayer
                key={component.uuid}
                index={index}
                component={component}
                indent={indent + 1}
                parentNode={slot}
                disableDrop={slotDisableDrop}
              />
            ))}
          </CollapsibleContent>
        )}
        {!slot.components.length && !slotDisableDrop && (
          <LayersDropZone
            layer={slot}
            position={'bottom'}
            indent={indent + 1}
          />
        )}
      </Collapsible.Root>
      {isTemplateMode && parentNode && (
        <ExposeSlotDialog
          open={exposeDialogOpen}
          onOpenChange={setExposeDialogOpen}
          onConfirm={handleExposeConfirm}
          slotName={slot.name}
        />
      )}
    </Box>
  );
};

export default SlotLayer;
