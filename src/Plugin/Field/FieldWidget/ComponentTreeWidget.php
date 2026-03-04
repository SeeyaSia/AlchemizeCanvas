<?php

declare(strict_types=1);

namespace Drupal\canvas\Plugin\Field\FieldWidget;

use Drupal\canvas\Entity\ContentTemplate;
use Drupal\Core\Field\Attribute\FieldWidget;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\WidgetBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;

/**
 * A widget for the component_tree field type.
 *
 * Renders an "Edit in Canvas" link that opens the Canvas editor scoped to the
 * field's exposed slot. The actual editing of component trees happens in the
 * Canvas React editor, not in the standard Drupal entity form.
 *
 * @see \Drupal\canvas\Controller\EntityFormController
 * @see \Drupal\canvas\Plugin\Field\FieldType\ComponentTreeItem
 */
#[FieldWidget(
  id: 'canvas_component_tree_widget',
  label: new TranslatableMarkup('Drupal Canvas'),
  description: new TranslatableMarkup('Indicates this field is managed by the Drupal Canvas editor.'),
  field_types: [
    'component_tree',
  ],
  multiple_values: TRUE,
)]
class ComponentTreeWidget extends WidgetBase {

  /**
   * {@inheritdoc}
   */
  public function formElement(FieldItemListInterface $items, $delta, array $element, array &$form, FormStateInterface $form_state) {
    $entity = $items->getEntity();
    $field_name = $items->getName();

    $element['#type'] = 'container';
    $element['#attributes'] = [
      'class' => ['canvas-component-tree-widget'],
    ];

    // Entity must be saved before Canvas editing is available.
    if ($entity->isNew()) {
      $element['message'] = [
        '#markup' => '<p>' . $this->t('Save this content first, then edit in Canvas.') . '</p>',
      ];
      return $element;
    }

    // Check for an enabled content template with this field mapped to a slot.
    $template = ContentTemplate::loadForEntity($entity, 'full');
    if ($template && $template->status() && isset($template->getActiveExposedSlots()[$field_name])) {
      $slot = $template->getActiveExposedSlots()[$field_name];
      $field_label = $items->getFieldDefinition()->getLabel();

      // Show the field label and slot name for identification.
      $element['header'] = [
        '#type' => 'html_tag',
        '#tag' => 'strong',
        '#value' => $field_label,
      ];
      $element['slot_info'] = [
        '#markup' => '<p class="description">' . $this->t('Slot: %slot_label · Field: @field_name', [
          '%slot_label' => $slot['label'],
          '@field_name' => $field_name,
        ]) . '</p>',
      ];

      $element['link'] = [
        '#type' => 'link',
        '#title' => $this->t('Edit in Canvas'),
        '#url' => Url::fromRoute('canvas.entity.layout', [
          'entity_type' => $entity->getEntityTypeId(),
          'entity' => $entity->id(),
        ]),
        '#attributes' => [
          'class' => ['button', 'button--primary', 'canvas-editor-link'],
          'target' => '_blank',
        ],
      ];
    }
    else {
      $element['message'] = [
        '#markup' => '<p>' . $this->t('This canvas field is not yet assigned to a slot in the content template.') . '</p>',
      ];
    }

    return $element;
  }

  /**
   * {@inheritdoc}
   */
  public function extractFormValues(FieldItemListInterface $items, array $form, FormStateInterface $form_state) {
    // Component tree values are managed by the Canvas React editor via its
    // own API endpoints, not through the standard entity form. Intentionally
    // do nothing here to prevent the standard form from overwriting Canvas-
    // managed data.
    // @see \Drupal\canvas\Controller\ApiLayoutController
  }

}
