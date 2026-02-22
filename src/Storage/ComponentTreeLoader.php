<?php

declare(strict_types=1);

namespace Drupal\canvas\Storage;

use Drupal\canvas\Entity\ContentTemplate;
use Drupal\canvas\Entity\Page;
use Drupal\Core\Entity\EntityFieldManagerInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\canvas\Entity\ComponentTreeEntityInterface;
use Drupal\canvas\Plugin\Field\FieldType\ComponentTreeItem;
use Drupal\canvas\Plugin\Field\FieldType\ComponentTreeItemList;

/**
 * Handles loading a component tree from entities.
 */
final class ComponentTreeLoader {

  public function __construct(
    private readonly EntityFieldManagerInterface $entityFieldManager,
  ) {}

  /**
   * Loads a component tree from an entity.
   *
   * @param \Drupal\canvas\Entity\ComponentTreeEntityInterface|\Drupal\Core\Entity\FieldableEntityInterface $entity
   *   The entity that stores the component tree. If it does not specifically
   *   implement ComponentTreeEntityInterface, then it is expected to be a
   *   fieldable entity with at least one field that stores a component tree.
   *
   * @return \Drupal\canvas\Plugin\Field\FieldType\ComponentTreeItemList
   *   The component tree item list for the entity.
   */
  public function load(ComponentTreeEntityInterface|FieldableEntityInterface $entity): ComponentTreeItemList {
    if ($entity instanceof ComponentTreeEntityInterface) {
      return $entity->getComponentTree();
    }
    $field_name = $this->getCanvasFieldName($entity);
    $item = $entity->get($field_name);
    \assert($item instanceof ComponentTreeItemList);
    return $item;
  }

  /**
   * Gets the Canvas field name from the entity.
   *
   * @param \Drupal\Core\Entity\FieldableEntityInterface $entity
   *   The entity.
   * @param string|null $field_name
   *   Optional specific field name to verify. When provided,
   *   validates it is a component_tree field on the entity.
   *
   * @return string
   *   The Canvas field name, or throws an exception
   *   if not found or not supported entity type/bundle.
   *
   * @throws \LogicException
   */
  public function getCanvasFieldName(FieldableEntityInterface $entity, ?string $field_name = NULL): string {
    // Allow canvas_page entities unconditionally.
    // For other entity types, allow if they have an enabled ContentTemplate
    // with exposed slots. This is the "per-content editing" path where the
    // entity stores slot content in its Canvas field.
    // @see https://drupal.org/i/3498525
    if ($entity->getEntityTypeId() !== Page::ENTITY_TYPE_ID && !$this->hasContentTemplateWithExposedSlots($entity)) {
      throw new \LogicException(\sprintf(
        'Entity type "%s" bundle "%s" does not support Canvas component tree editing. Either add an enabled ContentTemplate with exposed slots, or use a canvas_page entity.',
        $entity->getEntityTypeId(),
        $entity->bundle(),
      ));
    }

    // When a specific field is requested, verify it exists and
    // is component_tree type.
    if ($field_name !== NULL) {
      $map = $this->entityFieldManager->getFieldMapByFieldType(ComponentTreeItem::PLUGIN_ID);
      if (isset($map[$entity->getEntityTypeId()][$field_name])
        && \in_array($entity->bundle(), $map[$entity->getEntityTypeId()][$field_name]['bundles'], TRUE)) {
        return $field_name;
      }
      throw new \LogicException("Field '$field_name' is not a component_tree field on this entity.");
    }

    // Fallback: return first component_tree field found.
    $map = $this->entityFieldManager->getFieldMapByFieldType(ComponentTreeItem::PLUGIN_ID);
    foreach ($map[$entity->getEntityTypeId()] ?? [] as $found_field_name => $info) {
      if (\in_array($entity->bundle(), $info['bundles'], TRUE)) {
        return $found_field_name;
      }
    }
    throw new \LogicException("This entity does not have a Canvas field!");
  }

  /**
   * Checks if an entity has an enabled ContentTemplate with exposed slots.
   *
   * @param \Drupal\Core\Entity\FieldableEntityInterface $entity
   *   The entity to check.
   *
   * @return bool
   *   TRUE if the entity has an enabled ContentTemplate with at least one
   *   exposed slot, FALSE otherwise.
   */
  public function hasContentTemplateWithExposedSlots(FieldableEntityInterface $entity): bool {
    $template = ContentTemplate::loadForEntity($entity, 'full');
    return $template !== NULL && $template->status() && !empty($template->getActiveExposedSlots());
  }

}
