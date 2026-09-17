import { Text as RNText, StyleSheet, TextProps } from "react-native"

/** Minimal shared text primitive — placeholder for the future design system. */
export const Text = ({ children, ...props }: TextProps) => (
  <RNText style={styles.body}>{children}</RNText>
)

const styles = StyleSheet.create({
  body: {
    fontSize: 16,
  },
})
