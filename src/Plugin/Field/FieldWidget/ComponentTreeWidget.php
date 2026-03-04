<?php

declare(strict_types=1);

namespace Drupal\canvas\Plugin\Field\FieldWidget;

use Drupal\Core\Field\Attribute\FieldWidget;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\WidgetBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Symfony\Component\Validator\ConstraintViolationListInterface;

/**
 * A widget for the component_tree field type.
 *
 * This widget is informational only — it shows that the field is managed by
 * the Canvas editor and cannot be edited through the standard entity form.
 *
 * The widget intentionally:
 * - Does not render any form inputs (read-only display).
 * - Does not extract form values (preserves API-managed data).
 * - Suppresses field validation errors (data is managed externally).
 *
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
    $element['#type'] = 'container';
    $element['#attributes'] = [
      'class' => ['canvas-component-tree-widget'],
    ];

    $element['message'] = [
      '#markup' => '<p>' . $this->t('This field is managed by the Drupal Canvas editor.') . '</p>',
    ];

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

  /**
   * {@inheritdoc}
   */
  public function flagErrors(FieldItemListInterface $items, ConstraintViolationListInterface $violations, array $form, FormStateInterface $form_state) {
    // Component tree data is managed by the Canvas API, not the entity form.
    // Suppress all validation errors for this field to prevent API-managed
    // data (which may use uncollapsed input syntax or other internal formats)
    // from blocking standard entity form saves.
  }

}
