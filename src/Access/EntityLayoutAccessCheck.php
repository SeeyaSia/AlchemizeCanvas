<?php

declare(strict_types=1);

namespace Drupal\canvas\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\canvas\Entity\ContentTemplate;

/**
 * Access check for unified Canvas layout editing of all exposed slots.
 *
 * Verifies that the entity has an enabled ContentTemplate with at least one
 * active exposed slot, and that the user has update access to the entity.
 *
 * @internal
 */
final class EntityLayoutAccessCheck {

  /**
   * Checks access for the unified layout route.
   */
  public function access(
    FieldableEntityInterface $entity,
    AccountInterface $account,
  ): AccessResultInterface {
    // Load ContentTemplate for entity bundle + full view mode.
    $template = ContentTemplate::loadForEntity($entity, 'full');
    if (!$template || !$template->status()) {
      return AccessResult::forbidden('No enabled content template.')
        ->addCacheableDependency($template ?? AccessResult::neutral());
    }

    // Require at least one active exposed slot.
    if (empty($template->getActiveExposedSlots())) {
      return AccessResult::forbidden('Content template has no active exposed slots.')
        ->addCacheableDependency($template);
    }

    // Check entity update access.
    return $entity->access('update', $account, TRUE)
      ->addCacheableDependency($template);
  }

}
