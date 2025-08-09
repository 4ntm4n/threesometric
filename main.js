// Importera Three.js och nödvändiga moduler
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// =============================================================================
// === GLOBALA VARIABLER & KONSTANTER
// =============================================================================

// Scen-objekt
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
const controls = new OrbitControls(camera, renderer.domElement);
const raycaster = new THREE.Raycaster();

// Rit-tillstånd
let isDrawing = false;
let lineStartPoint = new THREE.Vector3();
let startMousePos = new THREE.Vector2();

// Hjälp-objekt för att undvika minnesallokering i animate-loopen
const VEC3_ZERO = new THREE.Vector3(0, 0, 0);
const loopPreviewPlane = new THREE.Plane();
const loopPlaneNormal = new THREE.Vector3();
const loopFreeEndPoint = new THREE.Vector3();
const loopLocalRay = new THREE.Ray();
const loopWorldFreeEndPoint = new THREE.Vector3();
const loopLookAtTarget = new THREE.Vector3();

// Minne för "enda källan till sanning"
let lastPreviewedDirection = new THREE.Vector3();
let lastPreviewedEndPoint = new THREE.Vector3();

// Mus-koordinater
const mouse = new THREE.Vector2();

// Scen-innehåll
const permanentLines = [];
const permanentVertices = new THREE.Group();
const previewLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([VEC3_ZERO, VEC3_ZERO]),
    new THREE.LineBasicMaterial({ color: 0xffffff })
);
const planeMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
);
const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
);
const dynamicHelperPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.15
    })
);
dynamicHelperPlane.material.depthTest = false;


// =============================================================================
// === INITIALISERING
// =============================================================================

function init() {
    scene.background = new THREE.Color(0x22223b);
    const aspectRatio = window.innerWidth / window.innerHeight;
    const frustumSize = 20;
    camera.left = -frustumSize * aspectRatio / 2;
    camera.right = frustumSize * aspectRatio / 2;
    camera.top = frustumSize / 2;
    camera.bottom = -frustumSize / 2;
    camera.position.set(50, 50, 50);
    camera.lookAt(VEC3_ZERO);
    camera.updateProjectionMatrix();
    scene.add(camera);

    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    controls.enableRotate = false;
    controls.mouseButtons = { MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.DOLLY, LEFT: null };

    const gridHelper = new THREE.GridHelper(100, 100, 0x444444, 0x888888);
    scene.add(gridHelper);
    
    planeMesh.rotation.x = -Math.PI / 2;
    scene.add(planeMesh);
    
    scene.add(marker);
    
    previewLine.visible = false;
    scene.add(previewLine);
    
    dynamicHelperPlane.visible = false;
    scene.add(dynamicHelperPlane);
    
    scene.add(permanentVertices);

    renderer.domElement.addEventListener('mousemove', onMouseMove, false);
    renderer.domElement.addEventListener('click', onClick, false);
    window.addEventListener('keyup', onKeyUp, false);
    window.addEventListener('resize', onWindowResize, false);

    animate();
    console.log("threesometric initierad!");
}


// =============================================================================
// === HJÄLPFUNKTIONER
// =============================================================================

function snapAngle(angle) {
    const normalizedAngle = (angle + 360) % 360;
    const isoAngles = [30, 90, 150, 210, 270, 330];
    return isoAngles.reduce((prev, curr) => {
        const diffToPrev = Math.min(Math.abs(normalizedAngle - prev), 360 - Math.abs(normalizedAngle - prev));
        const diffToCurr = Math.min(Math.abs(normalizedAngle - curr), 360 - Math.abs(normalizedAngle - curr));
        return diffToCurr < diffToPrev ? curr : prev;
    });
}

function getDirectionFromAngle(angle) {
    const directions = {
        330: new THREE.Vector3(1, 0, 0), 30:  new THREE.Vector3(0, 0, -1), 90:  new THREE.Vector3(0, 1, 0),
        150: new THREE.Vector3(-1, 0, 0), 210: new THREE.Vector3(0, 0, 1), 270: new THREE.Vector3(0, -1, 0)
    };
    return directions[angle];
}


// =============================================================================
// === EVENT-HANTERARE
// =============================================================================

function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
}

function onClick(event) {
    if (event.button !== 0) return;

    if (!isDrawing) {
        const intersects = raycaster.intersectObject(planeMesh);
        if (intersects.length === 0) return;

        isDrawing = true;
        lineStartPoint.copy(intersects[0].point);
        startMousePos.copy(mouse);

        const startVertex = new THREE.Mesh( new THREE.SphereGeometry(0.1, 16, 8), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
        startVertex.position.copy(lineStartPoint);
        permanentVertices.add(startVertex);

    } else {
        const direction3D = lastPreviewedDirection;
        const freeEndPoint = lastPreviewedEndPoint;

        const vectorFromStart = new THREE.Vector3().subVectors(freeEndPoint, lineStartPoint);
        const projectedVector = vectorFromStart.projectOnVector(direction3D);
        const finalEndPoint = new THREE.Vector3().addVectors(lineStartPoint, projectedVector);

        if (lineStartPoint.distanceTo(finalEndPoint) < 0.1) return; 

        const newGeometry = new THREE.BufferGeometry().setFromPoints([lineStartPoint, finalEndPoint]);
        const permanentLine = new THREE.Line(newGeometry, new THREE.LineBasicMaterial({ color: 0xffffff }));
        scene.add(permanentLine);
        permanentLines.push(permanentLine);

        const endVertex = new THREE.Mesh( new THREE.SphereGeometry(0.1, 16, 8), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
        endVertex.position.copy(finalEndPoint);
        permanentVertices.add(endVertex);

        // *** DEN SLUTGILTIGA LÖSNINGEN ***
        // 1. Uppdatera 3D-startpunkten för nästa linje
        lineStartPoint.copy(finalEndPoint);

        // 2. Beräkna den KORREKTA 2D-positionen som motsvarar den snappade 3D-punkten
        const snappedMousePosition = new THREE.Vector3();
        snappedMousePosition.copy(finalEndPoint).project(camera);

        // 3. Synkronisera BÅDE 2D-startpunkten OCH den globala muspositionen
        // Detta är nyckeln för att förhindra det ackumulerande felet.
        startMousePos.set(snappedMousePosition.x, snappedMousePosition.y);
        mouse.copy(startMousePos);
    }
}

function onKeyUp(event) {
    if (event.code === 'Escape') {
        isDrawing = false;
        previewLine.visible = false;
        dynamicHelperPlane.visible = false;
    }
}

function onWindowResize() {
    const aspectRatio = window.innerWidth / window.innerHeight;
    const frustumSize = 20;
    camera.left = -frustumSize * aspectRatio / 2;
    camera.right = frustumSize * aspectRatio / 2;
    camera.top = frustumSize / 2;
    camera.bottom = -frustumSize / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}


// =============================================================================
// === ANIMATIONSLOOP
// =============================================================================

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    raycaster.setFromCamera(mouse, camera);

    if (isDrawing) {
        const dragDistance = mouse.distanceTo(startMousePos);
        const startThreshold = 0.05;

        if (dragDistance > startThreshold) {
            previewLine.visible = true;
            dynamicHelperPlane.visible = true;

            const rawAngle = Math.atan2(mouse.y - startMousePos.y, mouse.x - startMousePos.x) * 180 / Math.PI;
            const snappedAngle = snapAngle(rawAngle);
            const direction3D = getDirectionFromAngle(snappedAngle);

            if (direction3D) {
                // *** SLUTGILTIG, STABIL LOGIK FÖR PLANVAL ***
                if (Math.abs(direction3D.y) === 1.0) {
                    // För vertikal ritning, välj ett FAST, världs-orienterat plan (YZ-planet).
                    // Detta är helt oberoende av kameran och kommer inte att rotera.
                    loopPlaneNormal.set(1, 0, 0);
                } else {
                    // För horisontell ritning, använd det stabila golvplanet.
                    loopPlaneNormal.set(0, 1, 0);
                }
                
                loopPreviewPlane.setFromNormalAndCoplanarPoint(loopPlaneNormal, VEC3_ZERO);
                
                loopLocalRay.copy(raycaster.ray);
                loopLocalRay.origin.sub(lineStartPoint);

                if (loopLocalRay.intersectPlane(loopPreviewPlane, loopFreeEndPoint)) {
                    loopWorldFreeEndPoint.copy(loopFreeEndPoint).add(lineStartPoint);

                    const positions = previewLine.geometry.attributes.position;
                    positions.setXYZ(0, lineStartPoint.x, lineStartPoint.y, lineStartPoint.z);
                    positions.setXYZ(1, loopWorldFreeEndPoint.x, loopWorldFreeEndPoint.y, loopWorldFreeEndPoint.z);
                    positions.needsUpdate = true;
                    marker.position.copy(loopWorldFreeEndPoint);
                    
                    lastPreviewedDirection.copy(direction3D);
                    lastPreviewedEndPoint.copy(loopWorldFreeEndPoint);

                    // Orientera det visuella planet korrekt
                    dynamicHelperPlane.position.copy(lineStartPoint);
                    if (loopPlaneNormal.y === 1.0) {
                        dynamicHelperPlane.up.set(0, 0, 1);
                    } else {
                        dynamicHelperPlane.up.set(0, 1, 0);
                    }
                    dynamicHelperPlane.lookAt(loopLookAtTarget.copy(lineStartPoint).add(loopPlaneNormal));
                } else {
                    previewLine.visible = false;
                    dynamicHelperPlane.visible = false;
                }
            }
        } else {
            previewLine.visible = false;
            dynamicHelperPlane.visible = false;
        }
    } else {
        const intersects = raycaster.intersectObject(planeMesh);
        if (intersects.length > 0) {
            marker.position.copy(intersects[0].point);
        }
    }

    renderer.render(scene, camera);
}

// Kör igång allt
init();
