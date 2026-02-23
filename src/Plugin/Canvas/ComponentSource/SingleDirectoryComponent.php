<?php

declare(strict_types=1);

namespace Drupal\canvas\Plugin\Canvas\ComponentSource;

use Drupal\canvas\Attribute\ComponentSource;
use Drupal\canvas\ComponentSource\UrlRewriteInterface;
use Drupal\Component\Plugin\Exception\PluginNotFoundException;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Extension\ThemeHandlerInterface;
use Drupal\Core\GeneratedUrl;
use Drupal\Core\Plugin\Component as ComponentPlugin;
use Drupal\Core\Render\Component\Exception\ComponentNotFoundException;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Theme\ComponentPluginManager;
use Drupal\Core\Theme\ExtensionType;
use Drupal\Core\Url;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Filesystem\Path;

/**
 * Defines a component source based on single-directory components.
 */
#[ComponentSource(
  id: self::SOURCE_PLUGIN_ID,
  label: new TranslatableMarkup('Single-Directory Components'),
  supportsImplicitInputs: FALSE,
  discovery: SingleDirectoryComponentDiscovery::class,
  updater: GeneratedFieldExplicitInputUxComponentInstanceUpdater::class,
  // @see \Drupal\Core\Theme\ComponentPluginManager::__construct()
  discoveryCacheTags: ['component_plugins'],
)]
final class SingleDirectoryComponent extends GeneratedFieldExplicitInputUxComponentSourceBase implements UrlRewriteInterface {

  public const SOURCE_PLUGIN_ID = 'sdc';

  protected ComponentPluginManager $componentPluginManager;
  protected ModuleHandlerInterface $moduleHandler;
  protected ThemeHandlerInterface $themeHandler;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->componentPluginManager = $container->get(ComponentPluginManager::class);
    $instance->moduleHandler = $container->get(ModuleHandlerInterface::class);
    $instance->themeHandler = $container->get(ThemeHandlerInterface::class);
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function isBroken(): bool {
    try {
      $this->getMetadata();
    }
    catch (ComponentNotFoundException) {
      return TRUE;
    }
    // @todo Check if the required props are the same in the plugin and the saved component.
    //   Consider returning an enum[] that could give more info for the
    //   developer, e.g. the multiple reasons that could make this as
    //   broken/invalid. See
    //   https://www.drupal.org/project/canvas/issues/3532514
    return FALSE;
  }

  public function determineDefaultFolder(): string {
    $plugin_definition = $this->getComponentPlugin()->getPluginDefinition();
    \assert(\is_array($plugin_definition));
    // TRICKY: SDCs metadata specifies `group`, but gets exposed as `category`.
    // @see \Drupal\Core\Theme\ComponentPluginManager::processDefinitionCategory()
    \assert(!empty($plugin_definition['category']));

    return (string) $plugin_definition['category'];
  }

  /**
   * {@inheritdoc}
   */
  protected function getComponentPlugin(): ComponentPlugin {
    // @todo this should probably use DefaultSingleLazyPluginCollection
    if ($this->componentPlugin === NULL) {
      // Statically cache the loaded plugin.
      $this->componentPlugin = $this->componentPluginManager->find($this->getSourceSpecificComponentId());
    }
    return $this->componentPlugin;
  }

  /**
   * {@inheritdoc}
   */
  public function defaultConfiguration(): array {
    return parent::defaultConfiguration() + [
      'local_source_id' => NULL,
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function getReferencedPluginClass(): ?string {
    try {
      return $this->componentPluginManager->getDefinition($this->getSourceSpecificComponentId())['class'];
    }
    catch (PluginNotFoundException) {
      return NULL;
    }
  }

  /**
   * {@inheritdoc}
   */
  public function calculateDependencies(): array {
    $dependencies = parent::calculateDependencies();
    $component = $this->getComponentPlugin();
    $provider = $component->getBaseId();
    if ($this->moduleHandler->moduleExists($provider)) {
      $dependencies['module'][] = $provider;
    }
    if ($this->themeHandler->themeExists($provider)) {
      $dependencies['theme'][] = $provider;
    }
    return $dependencies;
  }

  /**
   * {@inheritdoc}
   */
  public function getComponentDescription(): TranslatableMarkup {
    try {
      $component = $this->getComponentPlugin();
      return new TranslatableMarkup('Single-directory component: %name', [
        '%name' => $this->getMetadata()->name ?? $component->getPluginId(),
      ]);
    }
    catch (\Exception) {
      return new TranslatableMarkup('Invalid/broken Single-directory component');
    }
  }

  /**
   * {@inheritdoc}
   */
  public function renderComponent(array $inputs, array $slot_definitions, string $componentUuid, bool $isPreview = FALSE): array {
    [$props, $props_cacheability] = self::getResolvedPropsAndCacheability($inputs[self::EXPLICIT_INPUT_NAME] ?? []);

    // In preview mode, substitute example values for props that are NULL or
    // absent. This occurs when an optional entity field is mapped to an SDC
    // prop but the field has no value yet. Without this fallback, the
    // component (or a child component it embeds) fails SDC validation in the
    // Canvas editor.
    // @see \Drupal\canvas\Plugin\Canvas\ComponentSource\GeneratedFieldExplicitInputUxComponentSourceBase::hydrateComponent()
    if ($isPreview) {
      $this->substituteEmptyPropsWithExamples($props, $props_cacheability);
    }

    $build = [
      '#type' => 'component',
      '#component' => $this->getSourceSpecificComponentId(),
      '#props' => $props + [
        'canvas_uuid' => $componentUuid,
        'canvas_slot_ids' => \array_keys($slot_definitions),
        'canvas_is_preview' => $isPreview,
      ],
      '#attached' => [
        'library' => [
          'core/components.' . str_replace(':', '--', $this->getSourceSpecificComponentId()),
        ],
      ],
    ];
    $props_cacheability->applyTo($build);
    return $build;
  }

  /**
   * Substitutes NULL or absent props with their SDC example values.
   *
   * During preview, props may be NULL (required prop mapped to an empty
   * optional field) or entirely absent (optional prop removed by
   * hydrateComponent()). Either case can cause SDC validation failures —
   * directly for required props, or indirectly when the component's Twig
   * template passes sub-properties of an absent object prop to an embedded
   * child component.
   *
   * This method fills in the component's example values as placeholders for
   * all schema-defined props that have examples and are either NULL or absent,
   * so the preview renders correctly.
   *
   * @param array<string, mixed> $props
   *   The resolved props, modified in place.
   * @param \Drupal\Core\Cache\CacheableMetadata $cacheability
   *   Cacheability metadata to add URL generation cache tags to.
   */
  private function substituteEmptyPropsWithExamples(array &$props, CacheableMetadata $cacheability): void {
    $metadata = $this->getMetadata();
    $schema_properties = $metadata->schema['properties'] ?? [];

    foreach ($schema_properties as $prop_name => $prop_schema) {
      // Skip props that already have a non-NULL value.
      if (\array_key_exists($prop_name, $props) && $props[$prop_name] !== NULL) {
        continue;
      }

      $example = $prop_schema['examples'][0] ?? NULL;
      if ($example === NULL) {
        continue;
      }

      // Rewrite relative URLs in the example value using the component's
      // schema for guidance. Only rewrites string properties whose schema
      // declares a URL format; $ref-only schemas are used as-is.
      $props[$prop_name] = $this->rewriteExampleValueUrls($example, $prop_schema, $cacheability);
    }
  }

  /**
   * Recursively rewrites URL-formatted strings in an example value.
   *
   * Uses the JSON schema to identify which string properties have a URL format
   * and rewrites them using the component's URL resolver. Properties whose
   * schema is not inline (e.g. uses $ref without inline properties) are
   * returned unchanged — the preview may show a broken image, which is still
   * preferable to a rendering error.
   *
   * @param mixed $value
   *   The example value (or part thereof).
   * @param array $schema
   *   The JSON schema for this value.
   * @param \Drupal\Core\Cache\CacheableMetadata $cacheability
   *   Cacheability metadata to add URL generation cache tags to.
   *
   * @return mixed
   *   The rewritten value.
   */
  private function rewriteExampleValueUrls(mixed $value, array $schema, CacheableMetadata $cacheability): mixed {
    // JSON Schema `type` may be a string ("object") or an array (["object"])
    // after $ref resolution. Normalize to a string for comparison.
    $type = $schema['type'] ?? NULL;
    if (\is_array($type)) {
      $type = $type[0] ?? NULL;
    }

    // String with URL format: rewrite using the component's URL resolver.
    if ($type === 'string' && \is_string($value)) {
      $format = $schema['format'] ?? '';
      if (\in_array($format, ['uri', 'uri-reference', 'iri', 'iri-reference'], TRUE)) {
        $generated_url = $this->rewriteExampleUrl($value);
        $cacheability->addCacheableDependency($generated_url);
        return $generated_url->getGeneratedUrl();
      }
      return $value;
    }

    // Object: recurse into properties if the schema defines them inline.
    if ($type === 'object' && \is_array($value) && isset($schema['properties'])) {
      foreach ($value as $key => $v) {
        if (isset($schema['properties'][$key])) {
          $value[$key] = $this->rewriteExampleValueUrls($v, $schema['properties'][$key], $cacheability);
        }
      }
      return $value;
    }

    // Array: recurse into items if the schema defines them.
    if ($type === 'array' && \is_array($value) && isset($schema['items'])) {
      foreach ($value as $i => $v) {
        $value[$i] = $this->rewriteExampleValueUrls($v, $schema['items'], $cacheability);
      }
      return $value;
    }

    return $value;
  }

  /**
   * {@inheritdoc}
   */
  public function setSlots(array &$build, array $slots): void {
    $build['#slots'] = $slots;
  }

  /**
   * @todo Remove in clean-up follow-up; minimize non-essential changes.
   */
  public static function convertMachineNameToId(string $machine_name): string {
    return SingleDirectoryComponentDiscovery::getComponentConfigEntityId($machine_name);
  }

  /**
   * {@inheritdoc}
   */
  protected function getSourceLabel(): TranslatableMarkup {
    $component_plugin = $this->getComponentPlugin();
    \assert(\is_array($component_plugin->getPluginDefinition()));

    // The 'extension_type' key is guaranteed to be set.
    // @see \Drupal\Core\Theme\ComponentPluginManager::alterDefinition()
    $extension_type = $component_plugin->getPluginDefinition()['extension_type'];
    \assert($extension_type instanceof ExtensionType);
    return match ($extension_type) {
      ExtensionType::Module => $this->t('Module component'),
      ExtensionType::Theme => $this->t('Theme component'),
    };
  }

  /**
   * {@inheritdoc}
   */
  public function rewriteExampleUrl(string $url): GeneratedUrl {
    $parsed_url = parse_url($url);
    \assert(\is_array($parsed_url));
    if (array_intersect_key($parsed_url, array_flip(['scheme', 'host']))) {
      return (new GeneratedUrl())->setGeneratedUrl($url);
    }

    \assert(isset($parsed_url['path']));
    $path = ltrim($parsed_url['path'], '/');
    $template_path = $this->getComponentPlugin()->getTemplatePath();
    \assert(\is_string($template_path));
    $referenced_asset_path = Path::canonicalize(dirname($template_path) . '/' . $path);
    if (is_file($referenced_asset_path)) {
      // SDC example values pointing to assets included in the SDC.
      // For example, an "avatar" SDC that shows an image, and:
      // - the example value is `avatar.png`
      // - the SDC contains a file called `avatar.png`
      // - this returns `/path/to/drupal/path/to/sdc/avatar.png`, resulting in a
      //   working preview.
      return Url::fromUri('base:/' . $referenced_asset_path)
        ->toString(TRUE)
        // When the SDC is moved, the generated URL must be updated.
        ->addCacheTags($this->getPluginDefinition()['discoveryCacheTags']);
    }

    // SDC example values pointing to sample locations, not actual assets.
    // For example, a "call to action" SDC that points to a destination, and:
    // - the example value is `adopt-a-llama`
    // - this returns `/path/to/drupal/adopt-a-llama`, resulting in a
    //   reasonable preview, even though there is unlikely to be a page on the
    //   site with the `adapt-a-llama` path.
    return Url::fromUri('base:/' . $path)->toString(TRUE);
  }

}
