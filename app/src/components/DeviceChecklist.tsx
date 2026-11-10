import { strings } from '../strings'
import { DEVICES } from '../strings/devices'
import type { PlanScene, TechniqueDevice } from '../types'
import { deviceGroups } from './directionPicks'

type Props = {
  scene: PlanScene
  disabled: boolean
  onChange: (devices: TechniqueDevice[]) => void
}

/** The scene's devices as a checklist (§9): the AI's answers first, the user corrects them. */
export function DeviceChecklist({ scene, disabled, onChange }: Props) {
  const { ai, sub, rest } = deviceGroups(scene)
  const toggle = (device: TechniqueDevice) => {
    onChange(
      scene.devices.includes(device)
        ? scene.devices.filter((item) => item !== device)
        : [...scene.devices, device],
    )
  }
  const row = (device: TechniqueDevice, tag: string | null) => (
    <li key={device}>
      <label className="device-row">
        <input
          type="checkbox"
          checked={scene.devices.includes(device)}
          disabled={disabled}
          onChange={() => {
            toggle(device)
          }}
        />
        <span>
          <span className="device-name">
            {DEVICES[device].name}
            {tag && <small className="device-tag">{tag}</small>}
          </span>
          <small className="device-question">{DEVICES[device].question}</small>
        </span>
      </label>
    </li>
  )
  return (
    <section className="direction-devices" aria-label={strings.direction.devicesTitle}>
      <h4>{strings.direction.devicesTitle}</h4>
      <ul>
        {ai.map((device) => row(device, strings.direction.aiTag))}
        {sub.map((device) => row(device, strings.direction.subTag))}
      </ul>
      <details open={rest.some((device) => scene.devices.includes(device))}>
        <summary>{strings.direction.otherDevices(rest.length)}</summary>
        <ul>{rest.map((device) => row(device, null))}</ul>
      </details>
    </section>
  )
}
