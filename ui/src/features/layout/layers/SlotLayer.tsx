import { useCallback, useMemo } from 'react';
import { CollapsibleContent } from '@radix-ui/react-collapsible';
import * as Collapsible from '@radix-ui/react-collapsible';
import { TriangleDownIcon, TriangleRightIcon } from '@radix-ui/react-icons';
import { Box, Flex } from '@radix-ui/themes';

import { useAppDispatch, useAppSelector } from '@/app/hooks';
import SidebarNode from '@/components/sidePanel/SidebarNode';
import ComponentLayer from '@/features/layout/layers/ComponentLayer';
import LayersDropZone from '@/features/layout/layers/LayersDropZone';
import {
  selectCollapsedLayers,
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
  const templateContext = useAppSelector(selectTemplateContext);
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

  // In per-content mode, disable drops into non-exposed slots
  const slotDisableDrop = disableDrop
    || (templateContext != null && !isSlotExposed);
  const slotId = slot.id;
  const isCollapsed = collapsedLayers.includes(slotId);

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
          title={slotName}
          draggable={false}
          variant="slot"
          open={!isCollapsed}
          disabled={slotDisableDrop}
          indent={indent}
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
    </Box>
  );
};

export default SlotLayer;
