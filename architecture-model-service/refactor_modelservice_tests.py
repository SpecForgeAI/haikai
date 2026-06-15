"""
Refactor ModelService-based tests to use @InjectMocks instead of manual ctor.
Targets known-broken tests:
- ModelServiceProjectContextTest
- ModelServiceUserJourneyGapTest
- UserJourneyLinkGapFillTest

(ModelServiceDiagramTypePersistenceTest was edited manually.)
"""
import re
from pathlib import Path

# Block of @Mock decls that match ModelService's declared-field order.
MOCK_BLOCK = """    // ModelService dependencies in declaration order.
    @Mock private ModelFileRepository modelFileRepository;
    @Mock private ProjectRepository projectRepository;
    @Mock private ArchitectureRepository architectureRepository;
    @Mock private BusinessUserRepository businessUserRepository;
    @Mock private BusinessProcessRepository businessProcessRepository;
    @Mock private ProcessActivityRepository processActivityRepository;
    @Mock private BusinessPointRepository businessPointRepository;
    @Mock private ApplicationRepository applicationRepository;
    @Mock private ApplicationComponentRepository applicationComponentRepository;
    @Mock private ServiceRepository serviceRepository;
    @Mock private InterfaceRepository interfaceRepository;
    @Mock private EndpointRepository endpointRepository;
    @Mock private ClassRepository classRepository;
    @Mock private MethodRepository methodRepository;
    @Mock private ApplicationPointRepository applicationPointRepository;
    @Mock private LogicalDataEntityRepository logicalDataEntityRepository;
    @Mock private LogicalDataAttributeRepository logicalDataAttributeRepository;
    @Mock private PhysicalDataEntityRepository physicalDataEntityRepository;
    @Mock private PhysicalDataAttributeRepository physicalDataAttributeRepository;
    @Mock private AppBusinessPointRepository appBusinessPointRepository;
    @Mock private InteractionRepository interactionRepository;
    @Mock private EventRepository eventRepository;
    @Mock private StateRepository stateRepository;
    @Mock private StateTransitionRepository stateTransitionRepository;
    @Mock private ActivityRepository activityRepository;
    @Mock private ActivityFlowRepository activityFlowRepository;
    @Mock private ActivityPartitionRepository activityPartitionRepository;
    @Mock private UIScreenRepository uiScreenRepository;
    @Mock private UIWorkflowTransitionRepository uiWorkflowTransitionRepository;
    @Mock private UIContractRepository uiContractRepository;
    @Mock private UIComponentRepository uiComponentRepository;
    @Mock private UIActionRepository uiActionRepository;
    @Mock private UICharacteristicRepository uiCharacteristicRepository;
    @Mock private BusinessLogicRepository businessLogicRepository;
    @Mock private PackageSetRepository packageSetRepository;
    @Mock private PackageRepository packageRepository;
    @Mock private PackageSetDefaultRuleRepository packageSetDefaultRuleRepository;
    @Mock private DataEntityPointRepository dataEntityPointRepository;
    @Mock private UserJourneyRepository userJourneyRepository;
    @Mock private ActivityStepRepository activityStepRepository;
    @Mock private EnvironmentRepository environmentRepository;
    @Mock private CloudAccountRepository cloudAccountRepository;
    @Mock private LocationRepository locationRepository;
    @Mock private NetworkRepository networkRepository;
    @Mock private SubnetRepository subnetRepository;
    @Mock private ComputeClusterRepository computeClusterRepository;
    @Mock private ComputeResourceRepository computeResourceRepository;
    @Mock private DeploymentUnitRepository deploymentUnitRepository;
    @Mock private LoadBalancerRepository loadBalancerRepository;
    @Mock private ListenerRepository listenerRepository;
    @Mock private DataStoreInstanceRepository dataStoreInstanceRepository;
    @Mock private InfrastructureResourceRepository infrastructureResourceRepository;
    @Mock private InfrastructurePointRepository infrastructurePointRepository;
    @Mock private BusinessUserBusinessPointRepository businessUserBusinessPointRepository;
    @Mock private ApplicationPointBusinessPointRepository applicationPointBusinessPointRepository;
    @Mock private LogicalDataEntityRelationshipRepository logicalDataEntityRelationshipRepository;
    @Mock private LogicalDataEntityPhysicalDataEntityRepository logicalDataEntityPhysicalDataEntityRepository;
    @Mock private LogicalDataAttributePhysicalDataAttributeRepository logicalDataAttributePhysicalDataAttributeRepository;
    @Mock private DataMovementRepository dataMovementRepository;
    @Mock private InterfaceLogicalEntityRepository interfaceLogicalEntityRepository;
    @Mock private ApplicationPointBusinessLogicRepository applicationPointBusinessLogicRepository;
    @Mock private UserJourneyLinkRepository userJourneyLinkRepository;
    @Mock private ResourceSubnetHostingRepository resourceSubnetHostingRepository;
    @Mock private DeploymentUnitComputeResourceRepository deploymentUnitComputeResourceRepository;
    @Mock private LoadBalancerResourceRouteRepository loadBalancerResourceRouteRepository;
    @Mock private ApplicationComputeDeploymentRepository applicationComputeDeploymentRepository;
    @Mock private DataEntityDataStoreHostingRepository dataEntityDataStoreHostingRepository;
    @Mock private ApplicationInfrastructureResourceUseRepository applicationInfrastructureResourceUseRepository;
    @Mock private ApplicationLoadBalancerExposureRepository applicationLoadBalancerExposureRepository;
    @Mock private IaCSourceRepository iacSourceRepository;
    @Mock private IaCResourceBindingRepository iacResourceBindingRepository;
    @Mock private LibraryRepository libraryRepository;
    @Mock private CodeUnitDependencyRepository codeUnitDependencyRepository;
    @Mock private DiscoveryRunRepository discoveryRunRepository;
    @Mock private DiagramRepository diagramRepository;
    @Mock private DiagramNodeRepository diagramNodeRepository;
    @Mock private DiagramEdgeRepository diagramEdgeRepository;
    @Mock private DiagramInteractionEdgeRepository diagramInteractionEdgeRepository;
    @Mock private DiagramDecorationRepository diagramDecorationRepository;
    @Mock private EntityMapper entityMapper;
    @Mock private DiagramMapper diagramMapper;
    @Mock private DiagramCanonicalizer diagramCanonicalizer;
    @Mock private DiagramSvgRenderer diagramSvgRenderer;
    @Mock private ProjectService projectService;
    @Mock private DataEntityPointEnsureService dataEntityPointEnsureService;

    @InjectMocks
    private ModelService modelService;
"""

def refactor(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    # Add lenient strictness
    if "@MockitoSettings" not in text:
        text = text.replace(
            "@ExtendWith(MockitoExtension.class)",
            "@ExtendWith(MockitoExtension.class)\n@MockitoSettings(strictness = Strictness.LENIENT)",
        )

    # Add imports
    if "import org.mockito.InjectMocks;" not in text:
        text = text.replace(
            "import org.mockito.Mock;",
            "import org.mockito.InjectMocks;\nimport org.mockito.Mock;",
        )
    if "import org.mockito.junit.jupiter.MockitoSettings;" not in text:
        text = text.replace(
            "import org.mockito.junit.jupiter.MockitoExtension;",
            "import org.mockito.junit.jupiter.MockitoExtension;\nimport org.mockito.junit.jupiter.MockitoSettings;\nimport org.mockito.quality.Strictness;",
        )
    if "import com.example.architecturemodel.service.export.DiagramSvgRenderer;" not in text:
        text = text.replace(
            "import com.example.architecturemodel.service.export.DiagramCanonicalizer;",
            "import com.example.architecturemodel.service.export.DiagramCanonicalizer;\nimport com.example.architecturemodel.service.export.DiagramSvgRenderer;",
        )
    if "import org.springframework.test.util.ReflectionTestUtils;" not in text:
        text = text.replace(
            "import org.mockito.Mock;",
            "import org.mockito.Mock;\nimport org.springframework.test.util.ReflectionTestUtils;",
        )

    # Replace the @Mock block + setUp() body. The pattern: starts with first '@Mock private ModelFileRepository'
    # and ends with the closing brace of setUp() method that contains `modelService = new ModelService(...)`.

    # Locate '@Mock private ModelFileRepository modelFileRepository;'
    start_idx = text.find("@Mock private ModelFileRepository modelFileRepository;")
    if start_idx == -1:
        print(f"  {path.name}: no @Mock block found")
        return False

    # Find the end -- where the manual `modelService = new ModelService(` block closes.
    new_ms_idx = text.find("modelService = new ModelService(", start_idx)
    if new_ms_idx == -1:
        print(f"  {path.name}: no `new ModelService(...)` found")
        return False
    # Find matching `);` after new_ms_idx -- naive bracket count
    depth = 0
    i = text.find("(", new_ms_idx)
    while i < len(text):
        c = text[i]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                # find the ';' after
                semi = text.find(";", i)
                # find end of `setUp()` method -- look for next '}' at the start of a line after semi
                end_brace = text.find("\n    }", semi)
                if end_brace == -1:
                    return False
                # We want to KEEP setUp's frame but replace the body. Easier: drop everything
                # from start_idx to (end of setUp's body, just before the closing brace),
                # and inject our own.

                # Find setUp open brace
                setup_open = text.rfind("void setUp() {", start_idx, new_ms_idx)
                if setup_open == -1:
                    # Try without `void`
                    setup_open = text.rfind("setUp() {", start_idx, new_ms_idx)
                if setup_open == -1:
                    return False
                setup_brace_idx = text.find("{", setup_open)
                # Now we replace: text[start_idx : end_brace] with MOCK_BLOCK + new setUp body
                # But better: preserve the @BeforeEach line + setUp signature.
                # Find the start of @BeforeEach
                before_each = text.rfind("@BeforeEach", start_idx, setup_open)
                if before_each == -1:
                    # Find any preceding annotation/line that we don't want to overwrite
                    before_each = setup_open

                replacement_setup = """@BeforeEach
    void setUp() {
        // ModelService is wired via @InjectMocks. Override mapper/canonicalizer deps
        // with real instances since tests assert their behaviour.
        ReflectionTestUtils.setField(modelService, "entityMapper", new EntityMapper());
        ReflectionTestUtils.setField(modelService, "diagramMapper", new DiagramMapper());
        ReflectionTestUtils.setField(modelService, "diagramCanonicalizer", new DiagramCanonicalizer());
    }"""

                new_text = (
                    text[:start_idx]
                    + MOCK_BLOCK
                    + "\n    "
                    + replacement_setup
                    + text[end_brace + len("\n    }"):]
                )
                # Remove any stray local "private ModelService modelService;" decl
                new_text = new_text.replace("    private ModelService modelService;\n", "")
                # Remove any "private DiagramCanonicalizer diagramCanonicalizer;" local field decl
                new_text = new_text.replace("    private DiagramCanonicalizer diagramCanonicalizer;\n", "")
                text = new_text
                break
        i += 1
    if text != original:
        path.write_text(text, encoding="utf-8")
        return True
    return False


def main():
    targets = [
        "src/test/java/com/example/architecturemodel/service/ModelServiceProjectContextTest.java",
        "src/test/java/com/example/architecturemodel/service/ModelServiceUserJourneyGapTest.java",
        "src/test/java/com/example/architecturemodel/service/UserJourneyLinkGapFillTest.java",
    ]
    for t in targets:
        p = Path(t)
        if not p.exists():
            print(f"  missing: {t}")
            continue
        ok = refactor(p)
        print(f"  {t}: {'patched' if ok else 'no-op'}")


if __name__ == "__main__":
    main()
