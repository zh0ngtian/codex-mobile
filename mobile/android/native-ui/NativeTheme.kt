package com.app.pakeplus.nativeui

import android.os.Build
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

internal object NativeMotion {
    const val short = 180
    const val medium = 300
    fun <T> spatial() = spring<T>(dampingRatio = 0.88f, stiffness = Spring.StiffnessMediumLow)
    fun <T> effects() = tween<T>(short)
}

@Composable
internal fun CodexMaterialTheme(appearance: String, fontScale: Float = 1f, content: @Composable () -> Unit) {
    val dark = when (appearance) { "light" -> false; "dark" -> true; else -> isSystemInDarkTheme() }
    val context = LocalContext.current
    val scheme = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
    } else if (dark) darkColorScheme(primary = Color(0xFFB5C8FF), secondary = Color(0xFFBFC6DC),
        tertiary = Color(0xFFDEBCE0), background = Color(0xFF111318), surface = Color(0xFF111318))
    else lightColorScheme(primary = Color(0xFF435E91), secondary = Color(0xFF575E71),
        tertiary = Color(0xFF725573), background = Color(0xFFF9F9FF), surface = Color(0xFFF9F9FF))
    val density = LocalDensity.current
    CompositionLocalProvider(LocalDensity provides Density(density.density, density.fontScale * fontScale)) {
    MaterialTheme(colorScheme = scheme, typography = Typography(), shapes = Shapes(
        extraSmall = RoundedCornerShape(8.dp), small = RoundedCornerShape(12.dp), medium = RoundedCornerShape(20.dp),
        large = RoundedCornerShape(28.dp), extraLarge = RoundedCornerShape(32.dp)), content = content)
    }
}
