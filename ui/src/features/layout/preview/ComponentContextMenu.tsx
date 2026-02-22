import { useCallback, useEffect, useMemo, useState } from 'react';
import { ContextMenu } from '@radix-ui/themes';

import { useAppDispatch, useAppSelector } from '@/app/hooks';
import PermissionCheck from '@/components/PermissionCheck';
import { UnifiedMenu } from '@/components/UnifiedMenu';
import {
  deleteNodeAndCleanupExposedSlots,
  duplicateNode,
  setUpdatePreview,
  shiftNode,
} from '@/features/layout/layoutModelSlice';
import { recurseNodes } from '@/features/layout/layoutUtils';
import ComponentContextMenuMoveInto from '@/features/layout/preview/ComponentContextMenuMoveInto';
import ComponentContextMenuRegions from '@/features/layout/preview/ComponentContextMenuRegions';
import ExposeSlotDialog from '@/features/layout/preview/ExposeSlotDialog';
import { setDialogOpen } from '@/features/ui/dialogSlice';
import {
  addExposedSlot,
  removeExposedSlot,
  selectEditorFrameContext,
  selectEditorViewPortScale,
  selectEditingExposedSlots,
  selectSelectedComponentUuid,
  unsetHoveredComponent,
} from '@/features/ui/uiSlice';
import useComponentSelection from '@/hooks/useComponentSelection';
import useCopyPasteComponents from '@/hooks/useCopyPasteComponents';
import useEditorNavigation from '@/hooks/useEditorNavigation';
import useGetComponentName from '@/hooks/useGetComponentName';
import { useGetComponentsQuery } from '@/services/componentAndLayout';

import type React from 'react';
import type { ReactNode } from 'react';
import type { UnifiedMenuType } from '@/components/UnifiedMenu';
import type { ComponentNode } from '@/features/layout/layoutModelSlice';

interface ComponentContextMenuProps {
  children: ReactNode;
  component: ComponentNode;
}

export const ComponentContextMenuContent: React.FC<
  Pick<ComponentContextMenuProps, 'component'> & {
    menuType?: UnifiedMenuType;
  }
> = ({ component, menuType = 'context' }) => {
  const dispatch = useAppDispatch();
  const { data: components } = useGetComponentsQuery();
  const componentName = useGetComponentName(component);
  const editorViewPortScale = useAppSelector(selectEditorViewPortScale);
  const selectedComponent = useAppSelector(selectSelectedComponentUuid);
  const { setSelectedComponent, unsetSelectedComponent } =
    useComponentSelection();
  const componentUuid = component.uuid;
  const { copySelectedComponent, pasteAfterSelectedComponent } =
    useCopyPasteComponents();
  const { navigateToCodeEditor } = useEditorNavigation();

  // Check if this is a code component
  const [componentType] = (component.type || '').split('@');
  const isCodeComponent =
    componentType &&
    components &&
    components[componentType]?.source === 'Code component';

  // In template mode, prevent deletion of components that own an exposed
  // slot (or contain a descendant that does). Removing such a component
  // would orphan the exposed slot definition.
  const editorFrameContext = useAppSelector(selectEditorFrameContext);
  const editingExposedSlots = useAppSelector(selectEditingExposedSlots);
  const isDeleteDisabledByExposedSlot = useMemo(() => {
    if (editorFrameContext !== 'template') return false;
    const exposedUuids = new Set(
      Object.values(editingExposedSlots).map((es) => es.component_uuid),
    );
    if (exposedUuids.size === 0) return false;
    // Check the component itself.
    if (exposedUuids.has(componentUuid)) return true;
    // Check all descendants.
    let found = false;
    recurseNodes(component, (node) => {
      if (exposedUuids.has(node.uuid)) found = true;
    });
    return found;
  }, [editorFrameContext, editingExposedSlots, componentUuid, component]);

  // Template mode: expose/remove slot functionality accessible from the
  // component context menu. This is needed because the slot overlay's context
  // menu is often unreachable when a component overlay covers the slot area.
  const isTemplateMode = editorFrameContext === 'template';
  const [exposeDialogOpen, setExposeDialogOpen] = useState(false);
  const [exposeDialogSlot, setExposeDialogSlot] = useState<{
    name: string;
    componentUuid: string;
  } | null>(null);

  // Build a map of which of this component's slots are currently exposed.
  const slotsExposureMap = useMemo(() => {
    if (!isTemplateMode || !component.slots?.length) return {};
    const map: Record<
      string,
      { isExposed: boolean; exposedKey: string | null; isEmpty: boolean }
    > = {};
    for (const slot of component.slots) {
      const entry = Object.entries(editingExposedSlots).find(
        ([, es]) =>
          es.component_uuid === componentUuid && es.slot_name === slot.name,
      );
      map[slot.name] = {
        isExposed: !!entry,
        exposedKey: entry?.[0] ?? null,
        isEmpty: slot.components.length === 0,
      };
    }
    return map;
  }, [isTemplateMode, component.slots, editingExposedSlots, componentUuid]);

  const handleExposeSlotConfirm = useCallback(
    (machineName: string, label: string) => {
      if (!exposeDialogSlot) return;
      dispatch(
        addExposedSlot({
          machineName,
          config: {
            component_uuid: exposeDialogSlot.componentUuid,
            slot_name: exposeDialogSlot.name,
            label,
          },
        }),
      );
      // Trigger a preview POST so the exposed slot change is auto-saved.
      dispatch(setUpdatePreview(true));
      setExposeDialogSlot(null);
    },
    [dispatch, exposeDialogSlot],
  );

  const handleRemoveExposedSlot = useCallback(
    (slotName: string) => {
      const entry = Object.entries(editingExposedSlots).find(
        ([, es]) =>
          es.component_uuid === componentUuid && es.slot_name === slotName,
      );
      if (entry) {
        dispatch(removeExposedSlot(entry[0]));
        // Trigger a preview POST so the removal is auto-saved.
        dispatch(setUpdatePreview(true));
      }
    },
    [dispatch, editingExposedSlots, componentUuid],
  );

  const handleDeleteClick = useCallback(
    (ev: React.MouseEvent<HTMLElement>) => {
      ev.stopPropagation();
      if (componentUuid) {
        dispatch(deleteNodeAndCleanupExposedSlots(componentUuid));
        unsetSelectedComponent();
      }
      dispatch(unsetHoveredComponent());
    },
    [componentUuid, dispatch, unsetSelectedComponent],
  );

  const handleDuplicateClick = useCallback(
    (ev: React.MouseEvent<HTMLElement>) => {
      ev.stopPropagation();
      dispatch(unsetHoveredComponent());

      if (componentUuid) {
        dispatch(duplicateNode({ uuid: componentUuid }));
      }
    },
    [dispatch, componentUuid],
  );

  const handleCopyClick = useCallback(
    (ev: React.MouseEvent<HTMLElement>) => {
      ev.stopPropagation();
      dispatch(unsetHoveredComponent());

      if (componentUuid) {
        copySelectedComponent(componentUuid);
      }
    },
    [dispatch, componentUuid, copySelectedComponent],
  );

  const handlePasteClick = useCallback(
    (ev: React.MouseEvent<HTMLElement>) => {
      ev.stopPropagation();
      dispatch(unsetHoveredComponent());

      if (componentUuid) {
        pasteAfterSelectedComponent(componentUuid);
      }
    },
    [dispatch, componentUuid, pasteAfterSelectedComponent],
  );

  const handleMoveUpClick = useCallback(
    (ev: React.MouseEvent<HTMLElement>) => {
      ev.stopPropagation();
      dispatch(unsetHoveredComponent());

      dispatch(shiftNode({ uuid: componentUuid, direction: 'up' }));
    },
    [dispatch, componentUuid],
  );

  const handleMoveDownClick = useCallback(
    (ev: React.MouseEvent<HTMLElement>) => {
      ev.stopPropagation();
      dispatch(unsetHoveredComponent());

      dispatch(shiftNode({ uuid: componentUuid, direction: 'down' }));
    },
    [dispatch, componentUuid],
  );

  const handleCreatePatternClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      e.stopPropagation();
      if (componentUuid !== selectedComponent) {
        setSelectedComponent(componentUuid);
      }
      dispatch(setDialogOpen('saveAsPattern'));
    },
    [componentUuid, dispatch, selectedComponent, setSelectedComponent],
  );

  const handleEditCodeClick = useCallback(
    (ev: React.MouseEvent<HTMLElement>) => {
      ev.stopPropagation();
      if (component.type && component.type.startsWith('js.')) {
        const machineNameAndVersion = component.type.substring(3);
        const [machineName] = machineNameAndVersion.split('@');
        navigateToCodeEditor(machineName);
      }
    },
    [component.type, navigateToCodeEditor],
  );

  const closeContextMenu = () => {
    // @todo https://www.drupal.org/i/3506657: There has to be a better way to close the context menu than firing an esc key press.
    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(escapeEvent);
  };

  useEffect(() => {
    // If the user zooms, close the context menu. Panning is no problem as the context menu prevents scrolling with the
    // mouse wheel, and it is closed automatically when panning via clicking the mouse.
    closeContextMenu();
  }, [editorViewPortScale]);

  return (
    <>
    <UnifiedMenu.Content
      aria-label={`Context menu for ${componentName}`}
      menuType={menuType}
      align="start"
      side="right"
    >
      <UnifiedMenu.Label>{componentName}</UnifiedMenu.Label>
      {isCodeComponent && (
        <PermissionCheck hasPermission="codeComponents">
          <UnifiedMenu.Item onClick={handleEditCodeClick}>
            Edit code
          </UnifiedMenu.Item>
        </PermissionCheck>
      )}
      <UnifiedMenu.Separator />

      <UnifiedMenu.Item onClick={handleDuplicateClick} shortcut="⌘ D">
        Duplicate
      </UnifiedMenu.Item>
      <UnifiedMenu.Item onClick={handleCopyClick} shortcut="⌘ C">
        Copy
      </UnifiedMenu.Item>
      <UnifiedMenu.Item onClick={handlePasteClick} shortcut="⌘ V">
        Paste
      </UnifiedMenu.Item>
      <PermissionCheck hasPermission="patterns">
        <UnifiedMenu.Separator />
        <UnifiedMenu.Item onClick={handleCreatePatternClick}>
          Create pattern
        </UnifiedMenu.Item>
      </PermissionCheck>
      <UnifiedMenu.Separator />

      <UnifiedMenu.Sub>
        <UnifiedMenu.SubTrigger>Move</UnifiedMenu.SubTrigger>
        <UnifiedMenu.SubContent>
          <UnifiedMenu.Item onClick={handleMoveUpClick}>
            Move up
          </UnifiedMenu.Item>
          <UnifiedMenu.Item onClick={handleMoveDownClick}>
            Move down
          </UnifiedMenu.Item>

          <UnifiedMenu.Separator />
          {components && Object.keys(components).length > 0 && (
            <ComponentContextMenuMoveInto
              component={component}
              components={components}
            />
          )}
        </UnifiedMenu.SubContent>
      </UnifiedMenu.Sub>
      <PermissionCheck hasPermission="globalRegions">
        <ComponentContextMenuRegions component={component} />
      </PermissionCheck>
      {isTemplateMode && component.slots?.length > 0 && (
        <>
          <UnifiedMenu.Separator />
          {component.slots.length === 1 ? (
            // Single slot: show expose/remove directly (no submenu needed).
            (() => {
              const slot = component.slots[0];
              const info = slotsExposureMap[slot.name];
              return info?.isExposed ? (
                <UnifiedMenu.Item
                  onClick={() => handleRemoveExposedSlot(slot.name)}
                >
                  Remove exposed slot
                </UnifiedMenu.Item>
              ) : (
                <UnifiedMenu.Item
                  disabled={
                    !info?.isEmpty
                  }
                  onClick={() => {
                    setExposeDialogSlot({
                      name: slot.name,
                      componentUuid,
                    });
                    setExposeDialogOpen(true);
                  }}
                >
                  Expose slot
                </UnifiedMenu.Item>
              );
            })()
          ) : (
            // Multiple slots: use a submenu listing each slot.
            <UnifiedMenu.Sub>
              <UnifiedMenu.SubTrigger>Expose slot</UnifiedMenu.SubTrigger>
              <UnifiedMenu.SubContent>
                {component.slots.map((slot) => {
                  const info = slotsExposureMap[slot.name];
                  return info?.isExposed ? (
                    <UnifiedMenu.Item
                      key={slot.name}
                      onClick={() => handleRemoveExposedSlot(slot.name)}
                    >
                      Remove: {slot.name}
                    </UnifiedMenu.Item>
                  ) : (
                    <UnifiedMenu.Item
                      key={slot.name}
                      disabled={
                        !info?.isEmpty
                      }
                      onClick={() => {
                        setExposeDialogSlot({
                          name: slot.name,
                          componentUuid,
                        });
                        setExposeDialogOpen(true);
                      }}
                    >
                      {slot.name}
                    </UnifiedMenu.Item>
                  );
                })}
              </UnifiedMenu.SubContent>
            </UnifiedMenu.Sub>
          )}
        </>
      )}
      <UnifiedMenu.Separator />
      <UnifiedMenu.Item
        shortcut="⌫"
        color="red"
        onClick={handleDeleteClick}
        disabled={isDeleteDisabledByExposedSlot}
      >
        {isDeleteDisabledByExposedSlot ? 'Delete (has exposed slot)' : 'Delete'}
      </UnifiedMenu.Item>
    </UnifiedMenu.Content>
    {isTemplateMode && exposeDialogSlot && (
      <ExposeSlotDialog
        open={exposeDialogOpen}
        onOpenChange={setExposeDialogOpen}
        onConfirm={handleExposeSlotConfirm}
        slotName={exposeDialogSlot.name}
      />
    )}
    </>
  );
};

const ComponentContextMenu: React.FC<ComponentContextMenuProps> = ({
  children,
  component,
}) => {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      <ComponentContextMenuContent component={component} />
    </ContextMenu.Root>
  );
};


export default ComponentContextMenu;
