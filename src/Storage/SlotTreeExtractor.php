<?php

declare(strict_types=1);

namespace Drupal\canvas\Storage;

use Drupal\canvas\Entity\ContentTemplate;
use Drupal\canvas\Plugin\Field\FieldType\ComponentTreeItem;

/**
 * Extracts slot subtrees from merged component trees.
 *
 * Used to separate per-entity slot content from template-owned components
 * when saving per-content editing data.
 */
final class SlotTreeExtractor {

  /**
   * Extracts only the slot (non-template) components from a merged tree.
   *
   * @param array $merged_components
   *   The merged tree's components array (template + slot components).
   * @param \Drupal\canvas\Entity\ContentTemplate $template
   *   The ContentTemplate to compare against.
   *
   * @return array
   *   Only the components that belong to the entity's slot content
   *   (i.e., not in the template's tree).
   */
  public function extractSlotSubtree(array $merged_components, ContentTemplate $template): array {
    $template_uuids = $this->getTemplateUuids($template);
    return array_values(array_filter(
      $merged_components,
      static fn(array $component): bool => !isset($template_uuids[$component['uuid']]),
    ));
  }

  /**
   * Filters a layout region's components to only contain slot components.
   *
   * Preserves the region structure (nodeType, id, name) but filters
   * the components array to exclude template-owned components.
   *
   * @param array $layout
   *   A region layout node with 'nodeType', 'id', 'name', 'components'.
   * @param \Drupal\canvas\Entity\ContentTemplate $template
   *   The ContentTemplate to compare against.
   *
   * @return array
   *   The same layout structure with filtered components.
   */
  public function filterLayoutToSlotComponents(array $layout, ContentTemplate $template): array {
    $layout['components'] = $this->extractSlotSubtree($layout['components'], $template);
    return $layout;
  }

  /**
   * Determines if a component UUID belongs to a slot (not the template).
   *
   * @param string $component_uuid
   *   The UUID of the component to check.
   * @param \Drupal\canvas\Entity\ContentTemplate $template
   *   The ContentTemplate to check against.
   *
   * @return bool
   *   TRUE if the component is a slot component (not in the template tree),
   *   FALSE if it belongs to the template.
   */
  public function isSlotComponent(string $component_uuid, ContentTemplate $template): bool {
    $template_uuids = $this->getTemplateUuids($template);
    return !isset($template_uuids[$component_uuid]);
  }

  /**
   * Returns a map of all component UUIDs from a template's tree.
   *
   * @param \Drupal\canvas\Entity\ContentTemplate $template
   *   The ContentTemplate.
   *
   * @return array<string, true>
   *   A map of template component UUIDs for O(1) lookup.
   */
  public function getTemplateUuidMap(ContentTemplate $template): array {
    return $this->getTemplateUuids($template);
  }

  /**
   * Collects all component UUIDs from a template's tree.
   *
   * @param \Drupal\canvas\Entity\ContentTemplate $template
   *   The ContentTemplate.
   *
   * @return array<string, true>
   *   A map of template component UUIDs for O(1) lookup.
   */
  private function getTemplateUuids(ContentTemplate $template): array {
    $uuids = [];
    $tree = $template->getComponentTree();
    foreach ($tree as $item) {
      \assert($item instanceof ComponentTreeItem);
      $uuids[$item->getUuid()] = TRUE;
    }
    return $uuids;
  }

}
