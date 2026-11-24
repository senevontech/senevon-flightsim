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
