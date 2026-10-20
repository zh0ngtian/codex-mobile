import importlib.util
import pathlib
import unittest


spec = importlib.util.spec_from_file_location('entry_analysis', pathlib.Path(__file__).parents[2] / 'scripts/analyze-conversation-entry.py')
analysis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analysis)


class EntryPositionTests(unittest.TestCase):
    def frame(self, height, offset, elapsed):
        return {'phase': 'native-frame', 'elapsedMs': elapsed, 'data': {
            'contentHeight': height, 'offset': offset, 'viewportHeight': 874,
            'topInset': 116, 'bottomInset': 157, 'presentationReady': True,
            'shownX': 0, 'shownHeight': height, 'shownBottom': height - offset,
            'viewportTop': 0, 'viewportBottom': 874}}

    def test_detects_captured_single_frame_height_backfill(self):
        # 真实静态会话：高度回填118.33pt后，下一显示帧仍为旧偏移。
        events = [self.frame(2336.333, 1619.333, 550.6),
                  self.frame(2454.667, 1619.333, 587.4),
                  self.frame(2454.667, 1737.667, 618.4)]
        report = analysis.analyze([{'events': events}])
        self.assertFalse(report['passed'])
        self.assertEqual(len(report['trials'][0]['regressions']), 1)
        self.assertAlmostEqual(report['trials'][0]['maximumGap'], 118.334, places=2)

    def test_accepts_synchronous_bottom_preservation(self):
        events = [self.frame(2336.333, 1619.333, 550.6),
                  self.frame(2454.667, 1737.667, 587.4)]
        self.assertTrue(analysis.analyze([{'events': events}])['passed'])

    def test_short_content_and_missing_frames(self):
        self.assertTrue(analysis.analyze([{'events': [self.frame(100, -116, 1)]}])['passed'])
        with self.assertRaises(ValueError):
            analysis.analyze([{'events': []}])

    def test_rejects_wrong_first_visible_position(self):
        events = [self.frame(1000, -116, 1), self.frame(1000, 283, 18)]
        self.assertFalse(analysis.analyze([{'events': events}])['passed'])

    def test_offscreen_initial_layout_is_not_a_visible_regression(self):
        first = self.frame(1000, -116, 1)
        first['data']['shownX'] = 321
        events = [first, self.frame(1000, 283, 18)]
        self.assertTrue(analysis.analyze([{'events': events}])['passed'])

    def test_rejects_model_correct_but_presented_position_wrong(self):
        events = [self.frame(2336.333, 1619.333, 550.6),
                  self.frame(2454.667, 1737.667, 587.4)]
        events[1]['data']['shownBottom'] += 118.334
        self.assertFalse(analysis.analyze([{'events': events}])['passed'])

    def test_accepts_previous_presented_layout_when_it_is_still_at_bottom(self):
        frame = self.frame(2454.667, 1737.667, 587.4)
        frame['data'].update(shownHeight=2336.333, shownBottom=717)
        self.assertTrue(analysis.analyze([{'events': [frame]}])['passed'])

    def test_requires_visible_presentation_sample(self):
        frame = self.frame(1000, 283, 1)
        frame['data']['shownX'] = 321
        self.assertFalse(analysis.analyze([{'events': [frame]}])['passed'])
        frame['data'].update(shownX=0, presentationReady=False)
        self.assertFalse(analysis.analyze([{'events': [frame]}])['passed'])
