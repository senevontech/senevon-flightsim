import { describe, expect, it } from "vitest";
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Vector3 } from "three";
import { bindParts, deflection, fitModel } from "../glbModel";
import { AIRCRAFT } from "../../aircraft";
import { DESIGNS } from "../designs";
import { emptyControls } from "../../sim/types";

const named = (name: string, parent: Object3D) => {
  const o = new Group();
  o.name = name;
  parent.add(o);
  return o;
};

describe("GLB aircraft models", () => {
  it("binds moving parts by loose node names, once per part", () => {
    const root = new Group();
    for (const n of ["Aileron.L", "aileron_R", "Elevator", "Rudder", "Propeller", "Flap_L"]) named(n, root);
    const gear = named("gear_main", root);
    named("wheel_left", gear); // inside an already bound gear group: not bound again
    named("fuselage", root);
    const kinds = bindParts(root).map((p) => p.kind).sort();
    expect(kinds).toEqual(["aileronL", "aileronR", "elevator", "flap", "gear", "prop", "rudder"]);
  });

  it("deflects surfaces with the same signs as the coded model", () => {
    const c = { ...emptyControls(), roll: 1, pitch: 1, yaw: 1 };
    expect(deflection("aileronL", c, 0)).toBeGreaterThan(0);
    expect(deflection("aileronR", c, 0)).toBeLessThan(0);
    expect(deflection("elevator", c, 0)).toBeLessThan(0);
    expect(deflection("flap", c, 1)).toBeGreaterThan(0);
  });

  it("fits a model to the design wingspan, centred, wheels on the sim's ground line", () => {
    const cfg = AIRCRAFT["sparrow-s1"];
    const plane = new Mesh(new BoxGeometry(20, 3, 16), new MeshBasicMaterial()); // wrong size and position
    plane.position.set(5, 7, -3);
    const holder = fitModel(plane, cfg, {});
    holder.updateMatrixWorld(true);
    const box = new Box3().setFromObject(holder, true);
    const size = box.getSize(new Vector3());
    expect(size.x).toBeCloseTo(DESIGNS["sparrow-s1"].wing.span, 3);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 3);
    const groundY = Math.min(...cfg.gear.map((g) => g.pos[1] - g.length));
    expect(box.min.y).toBeCloseTo(groundY, 3);
  });

  it("turns a model that faces +Z so its nose points forward (−Z)", () => {
    const cfg = AIRCRAFT["sparrow-s1"];
    const root = new Group();
    const body = new Mesh(new BoxGeometry(2, 1, 8), new MeshBasicMaterial());
    const nose = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshBasicMaterial());
    nose.position.z = 4.5; // nose toward +Z
    const wing = new Mesh(new BoxGeometry(10, 0.2, 1), new MeshBasicMaterial());
    root.add(body, nose, wing);
    const holder = fitModel(root, cfg, { yawDeg: 180 });
    holder.updateMatrixWorld(true);
    const p = nose.getWorldPosition(new Vector3());
    const c = new Box3().setFromObject(body, true).getCenter(new Vector3());
    expect(p.z).toBeLessThan(c.z);
  });
});

describe("pivotParts (OBJ models)", () => {
  it("moves a prop's origin to its centre and a surface's to its leading edge", async () => {
    const { BoxGeometry, Group, Mesh } = await import("three");
    const { bindParts, pivotParts } = await import("../glbModel");
    const root = new Group();
    const prop = new Mesh(new BoxGeometry(2, 2, 0.1).translate(0, 1, -4));
    prop.name = "propeller";
    const elev = new Mesh(new BoxGeometry(3, 0.1, 0.6).translate(0, 0.5, 5));
    elev.name = "elevator";
    root.add(prop, elev);
    const parts = bindParts(root);
    pivotParts(parts, 0);
    expect(prop.position.distanceTo(new Vector3(0, 1, -4))).toBeLessThan(1e-5);
    expect(elev.position.z).toBeCloseTo(4.7); // leading edge = forward (−Z) side
    expect(elev.position.y).toBeCloseTo(0.5);
    // the geometry stays where it was in the model
    root.updateMatrixWorld(true);
    const { Box3 } = await import("three");
    const b = new Box3().setFromObject(elev);
    expect(b.min.z).toBeCloseTo(4.7);
    expect(b.max.z).toBeCloseTo(5.3);
  });
});
