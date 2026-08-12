import { describe, expect, test } from 'bun:test'

import { ICON_BUTTON_CLASSES } from './remarkable-panel-view'

describe('ICON_BUTTON_CLASSES', () => {
    // Regression guard for issue #19. Obsidian's mobile stylesheet exempts
    // `.clickable-icon` from the touch-target padding it forces onto every other
    // button. Without the class, that padding drives the fixed-width icon button's
    // content box negative and the icon renders at zero width - a blank button on
    // Android and iPad. Dropping the class breaks mobile silently: desktop is
    // unaffected, so nothing else here would catch it.
    test('includes clickable-icon so mobile does not collapse the icon', () => {
        expect(ICON_BUTTON_CLASSES.split(' ')).toContain('clickable-icon')
    })

    test('keeps the plugin classes that carry the sizing and skin', () => {
        const classes = ICON_BUTTON_CLASSES.split(' ')
        expect(classes).toContain('remarkable-btn')
        expect(classes).toContain('remarkable-btn-icon')
    })
})
