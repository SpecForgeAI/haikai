package com.example.architecturemodel.service.export.terraform;

import com.example.architecturemodel.model.dto.entity.CloudAccountDto;
import com.example.architecturemodel.model.dto.entity.ComputeClusterDto;
import com.example.architecturemodel.model.dto.entity.ComputeResourceDto;
import com.example.architecturemodel.model.dto.entity.DataStoreInstanceDto;
import com.example.architecturemodel.model.dto.entity.DeploymentUnitDto;
import com.example.architecturemodel.model.dto.entity.EnvironmentDto;
import com.example.architecturemodel.model.dto.entity.InfrastructureResourceDto;
import com.example.architecturemodel.model.dto.entity.ListenerDto;
import com.example.architecturemodel.model.dto.entity.LoadBalancerDto;
import com.example.architecturemodel.model.dto.entity.LocationDto;
import com.example.architecturemodel.model.dto.entity.NetworkDto;
import com.example.architecturemodel.model.dto.entity.SubnetDto;

import java.util.List;

/**
 * Strategy interface for per-provider Terraform export.
 *
 * <p>Each method returns a list of {@link EmittedResource} fragments destined
 * for one of the four output files ({@code main.tf}, {@code variables.tf},
 * {@code outputs.tf}, {@code README.md}). The {@link TerraformContext}
 * supplies the loaded model + selected env / cloud-account / location plus
 * pre-built relationship lookup maps.
 *
 * <p>V1 only registers {@link GcpTerraformExporter} (providerId {@code "GCP"}).
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-export-gcp
 */
public interface TerraformExporter {

    /** Provider identifier used as the Spring bean lookup key (e.g. {@code "GCP"}). */
    String providerId();

    List<EmittedResource> exportEnvironment(EnvironmentDto entity, TerraformContext ctx);

    List<EmittedResource> exportCloudAccount(CloudAccountDto entity, TerraformContext ctx);

    List<EmittedResource> exportLocation(LocationDto entity, TerraformContext ctx);

    List<EmittedResource> exportNetwork(NetworkDto entity, TerraformContext ctx);

    List<EmittedResource> exportSubnet(SubnetDto entity, TerraformContext ctx);

    List<EmittedResource> exportComputeCluster(ComputeClusterDto entity, TerraformContext ctx);

    List<EmittedResource> exportComputeResource(ComputeResourceDto entity, TerraformContext ctx);

    List<EmittedResource> exportDeploymentUnit(DeploymentUnitDto entity, TerraformContext ctx);

    List<EmittedResource> exportLoadBalancer(LoadBalancerDto entity, TerraformContext ctx);

    List<EmittedResource> exportListener(ListenerDto entity, TerraformContext ctx);

    List<EmittedResource> exportDataStoreInstance(DataStoreInstanceDto entity, TerraformContext ctx);

    List<EmittedResource> exportInfrastructureResource(InfrastructureResourceDto entity, TerraformContext ctx);
}
