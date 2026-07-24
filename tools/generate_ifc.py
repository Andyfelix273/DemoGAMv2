#!/usr/bin/env python3
"""
Generatore IFC4 per KeyBiz HQ — Piano 4 e Piano 5
===================================================
Legge spaces.json prodotto da svg_parser.py e genera un file IFC4
conforme con:
  IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey × 2 → IfcSpace × N

Ogni IfcSpace ha:
  - GlobalId univoco (GUID IFC)
  - Name (nome stanza)
  - LongName (tipo BEMS)
  - Description (metratura e capacità)
  - Geometria 2D come IfcShapeRepresentation (footprint rettangolare)
  - Proprietà custom in IfcPropertySet "KeyBiz_BEMS":
      BEMSZoneId, BEMSType, AreaMq, CapacitaPersone, SVGElementId

Utilizzo:
    python3 generate_ifc.py
    python3 generate_ifc.py --input spaces.json --output keybiz_hq.ifc
"""

import argparse
import json
import uuid
from pathlib import Path
from datetime import datetime

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.api.root
import ifcopenshell.api.unit
import ifcopenshell.api.context
import ifcopenshell.api.project
import ifcopenshell.api.geometry
import ifcopenshell.api.spatial
import ifcopenshell.api.pset
import ifcopenshell.util.element

# ── Percorsi ─────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent.parent
OUT_DIR  = Path(__file__).parent / "output"
OUT_DIR.mkdir(exist_ok=True)

# ── Mapping tipo BEMS → IfcSpaceType predefined ──────────────────────────────
# In IFC4 IfcSpace.PredefinedType accetta solo: SPACE, PARKING, GFA, INTERNAL, EXTERNAL
# Usiamo INTERNAL per spazi interni, EXTERNAL per terrazzo, e aggiungiamo il tipo
# come proprietà nel PropertySet KeyBiz_BEMS
IFC_SPACE_PREDEFINED = {
    "ufficio":              "INTERNAL",
    "ufficio_direzionale":  "INTERNAL",
    "open_space":           "INTERNAL",
    "sala_riunioni":        "INTERNAL",
    "laboratorio":          "INTERNAL",
    "sala_break":           "INTERNAL",
    "reception":            "INTERNAL",
    "anticamera":           "INTERNAL",
    "server_room":          "INTERNAL",
    "corridoio":            "INTERNAL",
    "vano_scale":           "INTERNAL",
    "ascensore":            "INTERNAL",
    "terrazzo":             "EXTERNAL",
    "bagni":                "INTERNAL",
    "archivio":             "INTERNAL",
    "altro":                "INTERNAL",
}

# ── Colori per tipo (RGB 0-1 per IfcColourRgb) ───────────────────────────────
TYPE_COLORS = {
    "ufficio":              (0.18, 0.52, 0.80),  # blu
    "ufficio_direzionale":  (0.18, 0.30, 0.65),  # blu scuro
    "open_space":           (0.20, 0.65, 0.45),  # verde
    "sala_riunioni":        (0.55, 0.25, 0.75),  # viola
    "laboratorio":          (0.85, 0.55, 0.10),  # arancio
    "sala_break":           (0.90, 0.75, 0.10),  # giallo
    "reception":            (0.25, 0.70, 0.70),  # teal
    "anticamera":           (0.60, 0.60, 0.60),  # grigio
    "server_room":          (0.80, 0.20, 0.20),  # rosso
    "corridoio":            (0.40, 0.40, 0.40),  # grigio scuro
    "vano_scale":           (0.35, 0.35, 0.35),
    "terrazzo":             (0.30, 0.70, 0.30),  # verde chiaro
    "bagni":                (0.70, 0.85, 0.90),  # azzurro
    "altro":                (0.70, 0.70, 0.70),
}


def new_guid() -> str:
    """Genera un GUID IFC valido (22 caratteri base64-like)."""
    return ifcopenshell.guid.compress(uuid.uuid4().hex)


def create_ifc_model(spaces: list[dict], output_path: Path) -> ifcopenshell.file:
    """Crea il modello IFC4 completo."""
    
    # ── Crea file IFC ──────────────────────────────────────────────────────
    ifc = ifcopenshell.file(schema="IFC4")
    
    # ── Persone e organizzazione ───────────────────────────────────────────
    person = ifc.createIfcPerson(
        FamilyName="KeyBiz",
        GivenName="GAM Platform"
    )
    org = ifc.createIfcOrganization(Name="KeyBiz Srl — Metamorphosis")
    person_org = ifc.createIfcPersonAndOrganization(
        ThePerson=person,
        TheOrganization=org
    )
    app = ifc.createIfcApplication(
        ApplicationDeveloper=org,
        Version="1.0",
        ApplicationFullName="GAM Asset Manager — IFC Generator",
        ApplicationIdentifier="GAM-IFC-GEN"
    )
    owner_history = ifc.createIfcOwnerHistory(
        OwningUser=person_org,
        OwningApplication=app,
        State="READWRITE",
        ChangeAction="ADDED",
        CreationDate=int(datetime.now().timestamp()),
    )
    
    # ── Unità di misura ────────────────────────────────────────────────────
    unit_assignment = ifc.createIfcUnitAssignment(
        Units=[
            ifc.createIfcSIUnit(UnitType="LENGTHUNIT",    Name="METRE"),
            ifc.createIfcSIUnit(UnitType="AREAUNIT",      Name="SQUARE_METRE"),
            ifc.createIfcSIUnit(UnitType="VOLUMEUNIT",    Name="CUBIC_METRE"),
            ifc.createIfcSIUnit(UnitType="PLANEANGLEUNIT", Name="RADIAN"),
        ]
    )
    
    # ── Contesti geometrici ────────────────────────────────────────────────
    world_coord = ifc.createIfcAxis2Placement3D(
        Location=ifc.createIfcCartesianPoint((0.0, 0.0, 0.0))
    )
    geom_context = ifc.createIfcGeometricRepresentationContext(
        ContextIdentifier="Body",
        ContextType="Model",
        CoordinateSpaceDimension=3,
        Precision=1e-5,
        WorldCoordinateSystem=world_coord,
    )
    plan_context = ifc.createIfcGeometricRepresentationSubContext(
        ContextIdentifier="FootPrint",
        ContextType="Plan",
        ParentContext=geom_context,
        TargetView="PLAN_VIEW",
    )
    
    # ── Progetto ───────────────────────────────────────────────────────────
    project = ifc.createIfcProject(
        GlobalId=new_guid(),
        OwnerHistory=owner_history,
        Name="KeyBiz HQ — Sede Centrale Roma",
        Description="Modello IFC generato da planimetrie SVG tramite GAM Platform",
        RepresentationContexts=[geom_context],
        UnitsInContext=unit_assignment,
    )
    
    # ── Sito ──────────────────────────────────────────────────────────────
    site_placement = ifc.createIfcLocalPlacement(
        RelativePlacement=ifc.createIfcAxis2Placement3D(
            Location=ifc.createIfcCartesianPoint((0.0, 0.0, 0.0))
        )
    )
    site = ifc.createIfcSite(
        GlobalId=new_guid(),
        OwnerHistory=owner_history,
        Name="Roma — EUR",
        Description="Via Cristoforo Colombo, Roma",
        ObjectPlacement=site_placement,
        CompositionType="ELEMENT",
        RefLatitude=(41, 50, 0, 0),
        RefLongitude=(12, 28, 0, 0),
        RefElevation=20.0,
    )
    ifc.createIfcRelAggregates(
        GlobalId=new_guid(),
        OwnerHistory=owner_history,
        RelatingObject=project,
        RelatedObjects=[site],
    )
    
    # ── Edificio ──────────────────────────────────────────────────────────
    building_placement = ifc.createIfcLocalPlacement(
        PlacementRelTo=site_placement,
        RelativePlacement=ifc.createIfcAxis2Placement3D(
            Location=ifc.createIfcCartesianPoint((0.0, 0.0, 0.0))
        )
    )
    building = ifc.createIfcBuilding(
        GlobalId=new_guid(),
        OwnerHistory=owner_history,
        Name="KeyBiz HQ",
        Description="Sede Centrale KeyBiz — 5 piani, ~1200 mq lordi",
        ObjectPlacement=building_placement,
        CompositionType="ELEMENT",
    )
    ifc.createIfcRelAggregates(
        GlobalId=new_guid(),
        OwnerHistory=owner_history,
        RelatingObject=site,
        RelatedObjects=[building],
    )
    
    # ── Piani (IfcBuildingStorey) ──────────────────────────────────────────
    storeys = {}
    floor_names = {"P4": "Piano 4", "P5": "Piano 5"}
    floor_elevations = {"P4": 0.0, "P5": 3.2}
    
    for floor_id, floor_name in floor_names.items():
        elev = floor_elevations[floor_id]
        storey_placement = ifc.createIfcLocalPlacement(
            PlacementRelTo=building_placement,
            RelativePlacement=ifc.createIfcAxis2Placement3D(
                Location=ifc.createIfcCartesianPoint((0.0, 0.0, elev))
            )
        )
        storey = ifc.createIfcBuildingStorey(
            GlobalId=new_guid(),
            OwnerHistory=owner_history,
            Name=floor_name,
            Description=f"Planimetria {floor_name} — KeyBiz HQ",
            ObjectPlacement=storey_placement,
            CompositionType="ELEMENT",
            Elevation=elev,
        )
        storeys[floor_id] = storey
    
    ifc.createIfcRelAggregates(
        GlobalId=new_guid(),
        OwnerHistory=owner_history,
        RelatingObject=building,
        RelatedObjects=list(storeys.values()),
    )
    
    # ── Spazi (IfcSpace) ──────────────────────────────────────────────────
    # Raggruppa per piano
    from collections import defaultdict
    spaces_by_floor = defaultdict(list)
    for s in spaces:
        spaces_by_floor[s["floor_id"]].append(s)
    
    ifc_spaces_by_floor = defaultdict(list)
    
    # Scala SVG → metri
    # Piano 4: viewBox 1460×900 = 35m × 19m
    # Piano 5: viewBox 1800×1200 = 40m × 25m
    svg_scale = {
        "P4": {"mx": 35.0/1460.0, "my": 19.0/900.0, "ox": 0.0, "oy": 0.0},
        "P5": {"mx": 40.0/1800.0, "my": 25.0/1200.0, "ox": 0.0, "oy": 0.0},
    }
    
    for floor_id, floor_spaces in spaces_by_floor.items():
        sc = svg_scale[floor_id]
        elev = floor_elevations[floor_id]
        
        for space_data in floor_spaces:
            bbox = space_data["bbox"]
            bems_type = space_data["bems_type"]
            
            # Converti coordinate SVG → metri
            x_m = bbox["x"] * sc["mx"]
            y_m = bbox["y"] * sc["my"]
            w_m = bbox["w"] * sc["mx"]
            h_m = bbox["h"] * sc["my"]
            height_m = space_data.get("height_m", 3.2)
            
            # Placement locale dello spazio
            space_placement = ifc.createIfcLocalPlacement(
                PlacementRelTo=storeys[floor_id].ObjectPlacement,
                RelativePlacement=ifc.createIfcAxis2Placement3D(
                    Location=ifc.createIfcCartesianPoint((x_m, y_m, 0.0))
                )
            )
            
            # Geometria 2D footprint (rettangolo)
            pts = [
                ifc.createIfcCartesianPoint((0.0, 0.0)),
                ifc.createIfcCartesianPoint((w_m, 0.0)),
                ifc.createIfcCartesianPoint((w_m, h_m)),
                ifc.createIfcCartesianPoint((0.0, h_m)),
                ifc.createIfcCartesianPoint((0.0, 0.0)),
            ]
            polyline = ifc.createIfcPolyline(Points=pts)
            curve_bounded = ifc.createIfcArbitraryClosedProfileDef(
                ProfileType="AREA",
                OuterCurve=polyline,
            )
            
            # Estrusione per volume 3D
            extrusion_dir = ifc.createIfcDirection((0.0, 0.0, 1.0))
            solid = ifc.createIfcExtrudedAreaSolid(
                SweptArea=curve_bounded,
                Position=ifc.createIfcAxis2Placement3D(
                    Location=ifc.createIfcCartesianPoint((0.0, 0.0, 0.0))
                ),
                ExtrudedDirection=extrusion_dir,
                Depth=height_m,
            )
            
            # Rappresentazione geometrica
            shape_rep = ifc.createIfcShapeRepresentation(
                ContextOfItems=geom_context,
                RepresentationIdentifier="Body",
                RepresentationType="SweptSolid",
                Items=[solid],
            )
            product_shape = ifc.createIfcProductDefinitionShape(
                Representations=[shape_rep]
            )
            
            # Tipo predefinito IFC
            predefined_type = IFC_SPACE_PREDEFINED.get(bems_type, "USERDEFINED")
            
            # Crea IfcSpace
            ifc_space = ifc.createIfcSpace(
                GlobalId=new_guid(),
                OwnerHistory=owner_history,
                Name=space_data["name"],
                LongName=bems_type.replace("_", " ").title(),
                Description=f"{space_data['area_mq']} mq — cap. {space_data['capacita_persone']} pers.",
                ObjectPlacement=space_placement,
                Representation=product_shape,
                PredefinedType=predefined_type,
            )
            
            # PropertySet KeyBiz_BEMS
            # Genera zone_id dal floor e dal nome
            name_slug = space_data["svg_element_id"].replace(f"space-{floor_id.lower()}-", "")
            zone_idx = floor_spaces.index(space_data) + 1
            zone_id = f"Z-{floor_id}-{zone_idx:02d}"
            
            pset_props = [
                ifc.createIfcPropertySingleValue(
                    Name="BEMSZoneId",
                    NominalValue=ifc.createIfcLabel(zone_id),
                ),
                ifc.createIfcPropertySingleValue(
                    Name="BEMSType",
                    NominalValue=ifc.createIfcLabel(bems_type),
                ),
                ifc.createIfcPropertySingleValue(
                    Name="AreaMq",
                    NominalValue=ifc.createIfcReal(float(space_data["area_mq"])),
                ),
                ifc.createIfcPropertySingleValue(
                    Name="CapacitaPersone",
                    NominalValue=ifc.createIfcInteger(int(space_data["capacita_persone"])),
                ),
                ifc.createIfcPropertySingleValue(
                    Name="SVGElementId",
                    NominalValue=ifc.createIfcLabel(space_data["svg_element_id"]),
                ),
                ifc.createIfcPropertySingleValue(
                    Name="FloorId",
                    NominalValue=ifc.createIfcLabel(floor_id),
                ),
            ]
            
            pset = ifc.createIfcPropertySet(
                GlobalId=new_guid(),
                OwnerHistory=owner_history,
                Name="KeyBiz_BEMS",
                HasProperties=pset_props,
            )
            ifc.createIfcRelDefinesByProperties(
                GlobalId=new_guid(),
                OwnerHistory=owner_history,
                RelatedObjects=[ifc_space],
                RelatingPropertyDefinition=pset,
            )
            
            # Aggiungi GUID IFC al dizionario dello spazio per uso successivo
            space_data["ifc_guid"] = ifc_space.GlobalId
            space_data["zone_id"] = zone_id
            
            ifc_spaces_by_floor[floor_id].append(ifc_space)
            print(f"  ✓ [{floor_id}] '{space_data['name']}' → GUID={ifc_space.GlobalId} zone_id={zone_id}")
    
    # Aggrega spazi nei piani
    for floor_id, storey in storeys.items():
        floor_ifc_spaces = ifc_spaces_by_floor[floor_id]
        if floor_ifc_spaces:
            ifc.createIfcRelContainedInSpatialStructure(
                GlobalId=new_guid(),
                OwnerHistory=owner_history,
                RelatingStructure=storey,
                RelatedElements=floor_ifc_spaces,
            )
    
    # ── Salva file IFC ─────────────────────────────────────────────────────
    ifc.write(str(output_path))
    print(f"\n✓ IFC salvato: {output_path}")
    print(f"  Schema: {ifc.schema}")
    print(f"  Entità totali: {len(list(ifc))} ")
    
    return ifc


def main():
    parser = argparse.ArgumentParser(description="Generatore IFC4 da spaces.json")
    parser.add_argument("--input",  default="output/spaces.json", help="File spaces.json")
    parser.add_argument("--output", default="output/keybiz_hq.ifc", help="File IFC output")
    args = parser.parse_args()
    
    input_path  = Path(__file__).parent / args.input
    output_path = Path(__file__).parent / args.output
    
    print(f"Caricamento spazi da: {input_path}")
    with open(input_path, 'r', encoding='utf-8') as f:
        spaces = json.load(f)
    print(f"Spazi caricati: {len(spaces)}")
    
    print(f"\n{'='*60}")
    print("Generazione IFC4")
    print('='*60)
    
    ifc = create_ifc_model(spaces, output_path)
    
    # Aggiorna spaces.json con i GUID IFC assegnati
    spaces_out = Path(__file__).parent / "output" / "spaces_with_guid.json"
    with open(spaces_out, 'w', encoding='utf-8') as f:
        json.dump(spaces, f, indent=2, ensure_ascii=False)
    print(f"\n✓ Spazi con GUID salvati: {spaces_out}")
    
    print(f"\n{'='*60}")
    print("Riepilogo IFC generato:")
    print(f"  Progetto: KeyBiz HQ — Sede Centrale Roma")
    print(f"  Piani: Piano 4, Piano 5")
    print(f"  Spazi totali: {len(spaces)}")
    print(f"  File: {output_path} ({output_path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
