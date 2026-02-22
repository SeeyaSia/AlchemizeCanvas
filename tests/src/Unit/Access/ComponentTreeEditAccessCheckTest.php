<?php

declare(strict_types=1);

namespace Drupal\Tests\canvas\Unit\Access;

use Drupal\Core\Entity\EntityFieldManagerInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\canvas\Access\ComponentTreeEditAccessCheck;
use Drupal\canvas\Plugin\Field\FieldType\ComponentTreeItem;
use Drupal\canvas\Storage\ComponentTreeLoader;
use Drupal\Tests\UnitTestCase;

/**
 * @coversDefaultClass \Drupal\canvas\Access\ComponentTreeEditAccessCheck
 * @group canvas
 */
class ComponentTreeEditAccessCheckTest extends UnitTestCase {

  /**
   * Tests that a LogicException from the loader returns 403, not 500.
   *
   * When ComponentTreeLoader::load() throws a \LogicException (e.g. the
   * entity type is not allowed or has no Canvas field), the access check
   * should catch it and return a forbidden result instead of letting the
   * exception propagate as an uncaught 500 error.
   *
   * @covers ::access
   */
  public function testFieldableEntityWithoutCanvasFieldReturns403(): void {
    // Create a fieldable entity that is NOT a canvas_page — this will
    // cause ComponentTreeLoader::load() to throw \LogicException.
    $entity = $this->prophesize(FieldableEntityInterface::class);
    $entity->getEntityTypeId()->willReturn('node');
    $entity->bundle()->willReturn('page');

    $account = $this->createMock(AccountInterface::class);

    // Use the real ComponentTreeLoader with an EntityFieldManager that
    // returns no component_tree fields — guaranteeing the LogicException.
    $entityFieldManager = $this->prophesize(EntityFieldManagerInterface::class);
    $entityFieldManager
      ->getFieldMapByFieldType(ComponentTreeItem::PLUGIN_ID)
      ->willReturn([]);
    $loader = new ComponentTreeLoader($entityFieldManager->reveal());

    $accessChecker = new ComponentTreeEditAccessCheck($loader);
    $result = $accessChecker->access($entity->reveal(), $account);

    $this->assertFalse($result->isAllowed());
    $this->assertTrue($result->isForbidden());
    $this->assertEquals(
      'Entity does not support Canvas component tree editing.',
      $result->getReason(),
    );
  }

  /**
   * Tests that a non-fieldable, non-component-tree entity gets neutral access.
   *
   * Entities that do not implement FieldableEntityInterface or
   * ComponentTreeEntityInterface should receive a neutral access result
   * (no opinion), since this access check does not apply to them.
   *
   * @covers ::access
   */
  public function testNonFieldableEntityReturnsNeutral(): void {
    $entity = $this->createMock(EntityInterface::class);
    $account = $this->createMock(AccountInterface::class);

    $entityFieldManager = $this->prophesize(EntityFieldManagerInterface::class);
    $loader = new ComponentTreeLoader($entityFieldManager->reveal());

    $accessChecker = new ComponentTreeEditAccessCheck($loader);
    $result = $accessChecker->access($entity, $account);

    $this->assertTrue($result->isNeutral());
  }

}
