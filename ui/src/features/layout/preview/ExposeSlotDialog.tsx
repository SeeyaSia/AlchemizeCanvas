import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Flex, Select, Text } from '@radix-ui/themes';

import Dialog, { DialogFieldLabel } from '@/components/Dialog';
import { useGetCanvasFieldsQuery } from '@/services/componentAndLayout';

import type React from 'react';

interface ExposeSlotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (machineName: string, label: string) => void;
  slotName: string;
}

const ExposeSlotDialog: React.FC<ExposeSlotDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
  slotName,
}) => {
  const { entityType, bundle } = useParams();
  const { data: canvasFields, isLoading } = useGetCanvasFieldsQuery(
    { entityTypeId: entityType || '', bundle: bundle || '' },
    { skip: !entityType || !bundle },
  );

  const [selectedField, setSelectedField] = useState<string>('');

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      onOpenChange(newOpen);
      if (!newOpen) {
        setSelectedField('');
      }
    },
    [onOpenChange],
  );

  // If there's exactly one field, auto-select it.
  const effectiveField = useMemo(() => {
    if (selectedField) return selectedField;
    if (canvasFields?.length === 1) return canvasFields[0].name;
    return '';
  }, [selectedField, canvasFields]);

  const effectiveLabel = useMemo(() => {
    if (!effectiveField || !canvasFields) return '';
    const field = canvasFields.find((f) => f.name === effectiveField);
    return field?.label || '';
  }, [effectiveField, canvasFields]);

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Expose Slot"
      description="Make this slot available for per-content editing. Select the canvas field that will store the content for this slot."
      footer={{
        cancelText: 'Cancel',
        confirmText: 'Expose Slot',
        onConfirm: () => {
          if (effectiveField && effectiveLabel) {
            onConfirm(effectiveField, effectiveLabel);
            onOpenChange(false);
            setSelectedField('');
          }
        },
        isConfirmDisabled: !effectiveField,
      }}
    >
      <Flex direction="column" gap="3">
        <Flex direction="column" gap="1">
          <DialogFieldLabel htmlFor="expose-slot-field">
            Canvas field
          </DialogFieldLabel>
          {isLoading ? (
            <Text size="2" color="gray">
              Loading fields…
            </Text>
          ) : canvasFields && canvasFields.length > 0 ? (
            <>
              <Select.Root
                value={effectiveField}
                onValueChange={setSelectedField}
              >
                <Select.Trigger
                  id="expose-slot-field"
                  placeholder="Select a canvas field"
                />
                <Select.Content>
                  {canvasFields.map((field) => (
                    <Select.Item key={field.name} value={field.name}>
                      {field.label} ({field.name})
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              {effectiveField && (
                <Text size="1" color="gray">
                  Field: {effectiveField}
                </Text>
              )}
            </>
          ) : (
            <Text size="2" color="red">
              No canvas fields found on this content type. Add a Canvas
              (component_tree) field to the content type first.
            </Text>
          )}
        </Flex>
      </Flex>
    </Dialog>
  );
};

export default ExposeSlotDialog;
