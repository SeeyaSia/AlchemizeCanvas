<?php

declare(strict_types=1);

namespace Drupal\canvas\Menu;

use Drupal\Core\Menu\LocalTaskDefault;
use Drupal\Core\Routing\RouteMatchInterface;

/**
 * Provides a local task link for the Canvas Layout tab on node pages.
 *
 * Maps the {node} route parameter from the base route (entity.node.canonical)
 * to the {entity} parameter expected by canvas.entity.layout, and statically
 * sets {entity_type} to 'node'.
 *
 * @internal
 */
final class EntityLayoutTaskLink extends LocalTaskDefault {

  /**
   * {@inheritdoc}
   */
  public function getRouteParameters(RouteMatchInterface $route_match): array {
    $parameters = parent::getRouteParameters($route_match);
    // Map {node} from the current route to {entity} for the layout route.
    $node = $route_match->getParameter('node');
    if ($node !== NULL) {
      $parameters['entity'] = is_object($node) ? $node->id() : $node;
      $parameters['entity_type'] = 'node';
    }
    return $parameters;
  }

}
